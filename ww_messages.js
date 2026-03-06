module.exports = { addMessages };
const { directMention } = require("@slack/bolt");
const queries = require("./ww_queries");
const helpers = require("./ww_helpers");

let client;
let botUserId;
async function addMessages(app, webClient) {
  client = webClient;
  botUserId = (await client.auth.test({ token: process.env.SLACK_BOT_TOKEN }))
    .user_id;
  const regexStart = new RegExp(
    String.raw`<(@${botUserId})(\|.*)?>.*start.*stemming.*`,
    "i",
  );
  const regexStop = new RegExp(
    String.raw`<(@${botUserId})(\|.*)?>.*stop.*stemming.*`,
    "i",
  );
  const regexReminder = new RegExp(
    String.raw`<(@${botUserId})(\|.*)?>.*herinner.*\[(.*)\].*`,
    "i",
  );
  app.message(directMention, appMention);
  app.message(regexStart, startVoting);
  app.message(regexStop, stopVoting);
  app.message(regexReminder, remindVoters);
  app.message(/.*/, registerMessage);
  app.event("group_archive", registerArchive);
}

async function appMention({ message, say }) {
  await client.chat.postEphemeral({
    token: process.env.SLACK_BOT_TOKEN,
    channel: message.channel,
    user: message.user,
    text: `Hey bedankt voor je @-mentionen, als je vragen hebt voer dan het commando /wwhelp uit.`,
  });
}

async function startVoting({ message, say }) {
  if (message.type !== "message" || message.user !== "USLACKBOT") {
    if (message.type === "message") {
      say({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Hey <@${message.user}>, het is niet dat ik je niet aardig vind, maar dit mag alleen Slackbot, vertellers kunnen deze functionaliteit ook handmatig aanroepen met het bijbehorende commando. Fijne dag nog!`,
            },
          },
        ],
      });
    }
    return;
  }
  try {
    const game = await queries.getActiveGameWithChannel(message.channel);
    const channelUsersList = await helpers.getUserlist(client, message.channel);
    const pollName = await queries.getPollName(game.gms_id);
    const playersAlive = await queries.getAlive(game.gms_id);
    const channelUsersAlive = channelUsersList.filter((x) =>
      playersAlive.map((y) => y.user_id).includes(x.id),
    );
    if (!channelUsersAlive.length) {
      throw new Error(
        "Er zijn geen spelers waarop gestemd kan worden, poll is niet gestart",
      );
    }
    await queries.startPoll(game.gms_id, pollName);

    const chuckedUsersAlive = [];
    while (channelUsersAlive.length) {
      chuckedUsersAlive.push(channelUsersAlive.splice(0, 5));
    }

    let buttonblocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: pollName,
        },
      },
    ];
    for (const channelChunk of chuckedUsersAlive)
      buttonblocks = buttonblocks.concat([
        {
          type: "actions",
          elements: channelChunk.map((x) => ({
            type: "button",
            text: {
              type: "plain_text",
              text: x.name,
            },
            value: x.id,
            action_id: `stem-${x.id}`,
          })),
        },
      ]);

    const chatMessage = await client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: message.channel,
      text: pollName,
      blocks: buttonblocks,
    });
    await queries.setMessageIdPoll(game.gms_id, chatMessage);
  } catch (error) {
    console.log(
      `Er ging iets mis met automagisch starten stem ronde: ${error}`,
    );
  }
}

function isAuthorizedSlackbotMessage(message) {
  return message.type === "message" && message.user === "USLACKBOT";
}

function buildUnauthorizedSlackbotBlocks(userId) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Hey <@${userId}>, het is niet dat ik je niet aardig vind, maar dit mag alleen Slackbot, vertellers kunnen deze functionaliteit ook handmatig aanroepen met het bijbehorende commando. Fijne dag nog!`,
      },
    },
  ];
}

function filterAliveChannelUsers(channelUsersList, playersAlive) {
  const aliveIds = new Set(playersAlive.map((player) => player.user_id));
  return channelUsersList.filter((user) => aliveIds.has(user.id));
}

function splitSlackMessageId(slackMessageId) {
  const [channelId, messageTs] = slackMessageId.split("-");
  return { channelId, messageTs };
}

function buildPollStats(pollResults, mayorId) {
  const statsByPlayerId = new Map();

  const ensurePlayerStats = (playerId) => {
    if (!statsByPlayerId.has(playerId)) {
      statsByPlayerId.set(playerId, {
        hasVoted: false,
        missedVotes: undefined,
        votedBy: [],
        votedByMayor: false,
      });
    }
    return statsByPlayerId.get(playerId);
  };

  for (const pollResult of pollResults) {
    const voterStats = ensurePlayerStats(pollResult.gvo_gpl_slack_id);
    if (pollResult.gvo_voted_on_gpl_slack_id) {
      voterStats.hasVoted = true;
      const voteeStats = ensurePlayerStats(
        pollResult.gvo_voted_on_gpl_slack_id,
      );
      if (pollResult.gvo_gpl_slack_id === mayorId) {
        voteeStats.votedBy.push(`<@${pollResult.gvo_gpl_slack_id}> :tophat:`);
        voteeStats.votedByMayor = true;
      } else {
        voteeStats.votedBy.push(`<@${pollResult.gvo_gpl_slack_id}>`);
      }
    } else {
      voterStats.hasVoted = false;
      voterStats.missedVotes = pollResult.missedVotes;
    }
  }

  return statsByPlayerId;
}

function applyPollStats(channelUsersAlive, pollStats) {
  for (const playerAlive of channelUsersAlive) {
    const stats = pollStats.get(playerAlive.id);
    if (!stats) {
      continue;
    }

    playerAlive.hasVoted = stats.hasVoted;
    if (!stats.hasVoted) {
      playerAlive.missedVotes = stats.missedVotes;
    }
    if (stats.votedBy.length) {
      playerAlive.votedBy.push(...stats.votedBy);
    }
    if (stats.votedByMayor) {
      playerAlive.votedByMayor = true;
    }
  }
}

async function stopVoting({ message, say }) {
  if (!isAuthorizedSlackbotMessage(message)) {
    if (message.type === "message") {
      say({
        blocks: buildUnauthorizedSlackbotBlocks(message.user),
      });
    }
    return;
  }
  try {
    const game = await queries.getActiveGameWithChannel(message.channel);
    const channelUsersList = await helpers.getUserlist(client, message.channel);
    const playersAlive = await queries.getAlive(game.gms_id);
    const channelUsersAlive = filterAliveChannelUsers(
      channelUsersList,
      playersAlive,
    );

    const poll = await queries.stopPoll(game.gms_id);
    const pollResults = await queries.getPollResults(poll);
    if (!poll.gpo_slack_message_id.split) {
      throw new Error(
        "Resultaten konden niet weergegeven worden, poll is wel gesloten",
      );
    }
    const pollMessage = splitSlackMessageId(poll.gpo_slack_message_id);
    await client.chat.update({
      token: process.env.SLACK_BOT_TOKEN,
      channel: pollMessage.channelId,
      ts: pollMessage.messageTs,
      text: `${poll.gpo_title} is gesloten, uitslag volgt`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${poll.gpo_title} is gesloten, uitslag volgt`,
          },
        },
      ],
    });
    const mayorId = channelUsersAlive
      .filter((x) => x.status === "Burgemeester")
      .map((y) => y.id)
      .join();
    const pollStats = buildPollStats(pollResults, mayorId);
    applyPollStats(channelUsersAlive, pollStats);
    helpers.shuffle(channelUsersAlive);
    helpers.postDelayed(client, pollMessage.channelId, channelUsersAlive);
  } catch (error) {
    console.log(
      `Er ging iets mis met automagische sluiting stemming: ${error}`,
    );
  }
}

async function remindVoters({ message, say }) {
  if (message.type !== "message" || message.user !== "USLACKBOT") {
    if (message.type === "message") {
      say({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Hey <@${message.user}>, het is niet dat ik je niet aardig vind, maar dit mag alleen Slackbot, vertellers kunnen deze functionaliteit ook handmatig aanroepen met het bijbehorende commando. Fijne dag nog!`,
            },
          },
        ],
      });
    }
    return;
  }
  try {
    const game = await queries.getActiveGameWithChannel(message.channel);
    const time = message.text.match(/.*herinner.*\[(.*)\].*/)[1];
    const playersNotVoted = await queries.getAliveNotVoted(game.gms_id);
    const stemMessage = `Je hebt nog niet gestemd, je hebt tot ${time} om te stemmen, stemmen is verplicht`;
    const moderators = await queries.getModerators(game.gms_id);
    for (const player of playersNotVoted) {
      await helpers.sendIM(client, player.user_id, stemMessage);
      for (const moderator of moderators) {
        await helpers.sendIM(
          client,
          moderator,
          `Stemherinnering verstuurd naar <@${player.user_id}>`,
        );
      }
    }
    say({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Ok <@${message.user}>, done`,
          },
        },
      ],
    });
  } catch (error) {
    console.log(`Er ging iets mis met automagische stemherinnering: ${error}`);
  }
}

async function registerMessage({ message, say }) {
  try {
    const game = await queries.getGameWithChannel(message.channel);
    const ignoreSubtypes = [
      "channel_join",
      "channel_leave",
      "group_join",
      "group_leave",
      "bot_message",
      "reminder_add",
    ];
    if (
      message.user === "USLACKBOT" ||
      (message.subtype && ignoreSubtypes.includes(message.subtype))
    ) {
      //ignore unimportant messages
      return;
    }
    await queries.messageCountPlusPlus(message.user, game.gms_id);
    const threadTs = "thread_ts" in message ? message.thread_ts : null;
    let files = null;

    if ("files" in message) {
      files = [];
      for (const file of message.files) {
        files.push(`Image: <${file.permalink}|${file.title}>`);
      }
      files = files.join("\n");
    }

    try {
      await queries.storeMessage(
        message.channel,
        message.user,
        message.ts,
        message.text,
        files,
        threadTs,
      );
    } catch (error) {
      console.log(`Er ging iets mis met het opslaan van de message: ${error}`);
    }
  } catch (error) {
    console.log(
      `Er ging iets mis met het registeren van een message: ${error}`,
    );
  }
}

async function registerArchive({ event, context }) {
  try {
    await queries.logArchiveChannel(event.channel);
  } catch (error) {
    console.log(
      `Er ging iets mis met het registeren van het archiveren van een kanaal: ${error}`,
    );
  }
}
