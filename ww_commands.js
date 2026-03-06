const helpers = require("./ww_helpers");
const queries = require("./ww_queries");
const actions = require("./ww_actions");
const { t } = require("localizify");
module.exports = { addCommands };
let client;

function addCommands(app, webClient) {
  client = webClient;
  app.command(t("COMMANDLIST"), channelList);
  app.command(t("COMMANDSTATUS"), status);
  app.command(t("COMMANDARCHIVE"), archive);
  app.command(t("COMMANDVOTEROUND"), startVoteRound);
  app.command(t("COMMANDSTOPVOTEROUND"), stopVoteRound);
  app.command(t("COMMANDREMINDER"), voteReminder);
  app.command(t("COMMANDVOTESCORE"), voteScore);
  app.command(t("COMMANDSTARTQUICKVOTE"), startQuickVoteRound);
  app.command(t("COMMANDSTARTREGISTRATION"), startRegistration);
  app.command(t("COMMANDSTARTGAME"), startGameCommand);
  app.command(t("COMMANDSTOPGAME"), stopGameCommand);
  app.command(t("COMMANDCREATECHANNEL"), createChannel);
  app.command(t("COMMANDDEAD"), markDead);
  app.command(t("COMMANDREVIVE"), revive);
  app.command(t("COMMANDEXTRAMODERATOR"), addExtraModerator);
  app.command(t("COMMANDINVITEMODERATOR"), inviteModerators);
  app.command(t("COMMANDINVITEPLAYERS"), invitePlayers);
  app.command(t("COMMANDIWILLJOIN"), iWillJoin);
  app.command(t("COMMANDIWILLVIEW"), iWillView);
  app.command(t("COMMANDREMOVEYOURSELFFROMGAME"), iWillNotJoinAnymore);
  app.command(t("COMMANDGIVEROLES"), assignRoles);
  app.command(t("COMMANDLOTTO"), lotto);
  app.command(t("COMMANDHELP"), help);
  app.command(t("COMMANDSUMMARIZE"), summarize);
  app.command(t("COMMANDWHOISPLAYING"), whoIsPlaying);
}

function formatStatusLine(gameState, index) {
  if (gameState.gms_status === "REGISTERING") {
    return `${index + 1}. \t ${gameState.gms_name} \t ${t("TEXTOPENREGISTRATION")} ${t(
      "COMMANDIWILLJOIN",
    )} ${t("TEXTTOVIEW")} ${t("COMMANDIWILLVIEW")}. ${t("TEXTREGISTER")} ${gameState.players} ${t(
      "TEXTVIEWING",
    )} ${gameState.viewers} \n`;
  }
  if (gameState.gms_status === "STARTED") {
    return `${index + 1}. \t ${gameState.gms_name} \t ${t("TEXTGAMESTARTED")} ${gameState.alive} ${t(
      "TEXTPLAYERSAND",
    )} ${gameState.dead} ${t("TEXTDEADPLAYERS")} \n`;
  }
  return "";
}

function appendEnrolledGames(returnText, enrolledGames) {
  if (!enrolledGames.length) {
    return `${returnText}${t("TEXTNOTENROLLED")}`;
  }
  let output = returnText;
  for (const inGame of enrolledGames) {
    output += `\n ${t("TEXTENROLLEDIN")} ${inGame.gms_name}`;
  }
  return output;
}

async function postStatusResponse(command, returnText, say) {
  if (command.text.trim() === "public") {
    say({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${returnText}`,
          },
        },
      ],
    });
    return;
  }

  await client.chat.postEphemeral({
    token: process.env.SLACK_BOT_TOKEN,
    channel: command.channel_id,
    attachments: [
      { text: `${t("TEXTUSE")} ${t("COMMANDSTATUS")} ${t("TEXTPUBLIC")}` },
    ],
    text: `${returnText}`,
    user: command.user_id,
  });
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

function parseRoleDefinition(roleDefinition, neededRoles) {
  const roleName = roleDefinition.split(":")[0];
  const amountDefinition = roleDefinition.split(":")[1];

  if (!amountDefinition) {
    return {
      roleName,
      mandatoryCount: 0,
      optionalCount: neededRoles,
      nextNeededRoles: 0,
    };
  }

  const amountParts = amountDefinition.split("-");
  if (amountParts.length === 2) {
    const mandatoryCount = Number.parseInt(amountParts[0], 10);
    const optionalCount = Number.parseInt(amountParts[1], 10) - mandatoryCount;
    return {
      roleName,
      mandatoryCount,
      optionalCount,
      nextNeededRoles: neededRoles - mandatoryCount,
    };
  }

  const mandatoryCount = Number.parseInt(amountParts[0], 10);
  return {
    roleName,
    mandatoryCount,
    optionalCount: 0,
    nextNeededRoles: neededRoles - mandatoryCount,
  };
}

function assignMandatoryRoles(
  playersAlive,
  roleName,
  mandatoryCount,
  startIndex,
) {
  let nextIndex = startIndex;
  for (let i = 0; i < mandatoryCount; i++) {
    playersAlive[nextIndex++].rol = roleName;
  }
  return nextIndex;
}

function addOptionalRoles(optionals, roleName, optionalCount) {
  for (let i = 0; i < optionalCount; i++) {
    optionals.push(roleName);
  }
}

function assignOptionalRoles(playersAlive, optionals) {
  for (const player of playersAlive) {
    if (player.rol) {
      continue;
    }
    if (!optionals.length) {
      throw new Error(`${t("TEXTNOTENOUGHROLES")}`);
    }
    player.rol = optionals.pop();
  }
}

function parseSummaryDateRange(commandText) {
  const params = commandText.trim().split(" ");
  const regex = /202\d-[0-1]\d-[0-3]\d/m;
  if (regex.exec(params[0]) === null) {
    throw new Error("Date is invalid, format is yyyy-mm-dd");
  }
  if (params.length < 2) {
    return { startDate: params[0], endDate: params[0] };
  }
  if (regex.exec(params[1]) === null) {
    throw new Error("Date is invalid, format is yyyy-mm-dd");
  }
  return { startDate: params[0], endDate: params[1] };
}

function addSummaryHeader(summary, message, createdAt) {
  summary.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `*${message.gpl_name}* (${createdAt.toLocaleTimeString()})`,
      },
    ],
  });
}

function addSummaryText(summary, message) {
  if (message.gpm_blocks === "") {
    return;
  }
  summary.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `${message.gpm_blocks}`,
    },
  });
}

function addSummaryFiles(summary, filesRaw) {
  if (filesRaw === null) {
    return;
  }
  try {
    const files = JSON.parse(filesRaw);
    for (const file of files) {
      summary.push(file);
    }
  } catch (err) {
    console.error(err);
    const fallbackMatch = filesRaw.match(/<(.*)\|/);
    const fallbackText = fallbackMatch
      ? fallbackMatch[1]
      : "<failed loading image>";
    summary.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: fallbackText,
      },
    });
  }
}

async function addThreadedSummary(summary, channelId, messageTs) {
  const threadMessages = await queries.threadedMessagesInChannelByTS(
    channelId,
    messageTs,
  );
  for (const tMessage of threadMessages) {
    summary.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `> _${tMessage.gpl_name}_`,
        },
        {
          type: "mrkdwn",
          text: `_${tMessage.gpm_blocks}_`,
        },
      ],
    });
  }
}

async function postSummaryInChunks(summary, say) {
  while (summary.length) {
    const subSummary = summary.splice(0, 25);
    say({
      blocks: subSummary,
    });
  }
}

async function channelList({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    const voteChannelId = await queries.getChannel(
      game.gms_id,
      helpers.channelType.vote,
    );
    const channelUsersList = await helpers.getUserlist(client, voteChannelId);
    const playerList = await queries.getPlayerList(game.gms_id);
    const inputList = channelUsersList.filter((x) =>
      playerList.map((y) => y.gpl_slack_id).includes(x.id),
    );

    let returnText;
    let seperator = ", ";
    if (command.text.trim() === "newline") {
      seperator = "\n";
    }
    returnText = `*${t("TEXTLIVING")}* (${
      inputList.filter(
        (x) => x.status === t("TEXTPARTICIPANT") || x.status === t("TEXTMAYOR"),
      ).length
    }): ${inputList
      .filter(
        (x) => x.status === t("TEXTPARTICIPANT") || x.status === t("TEXTMAYOR"),
      )
      .map((x) => x.name)
      .join(seperator)}\n*${t("TEXTMULTIPLEDEAD")}* (${
      inputList.filter((x) => x.status === t("TEXTDEAD")).length
    }): ${inputList
      .filter((x) => x.status === t("TEXTDEAD"))
      .map((x) => x.name)
      .join(
        seperator,
      )}\n*${t("TEXTNOSTATUS")}* (${inputList.filter((x) => x.status === "").length}): ${inputList
      .filter((x) => !x.status)
      .map((x) => x.name)
      .join(seperator)}`;
    if (command.text.trim() === "public") {
      say({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: returnText,
            },
          },
        ],
      });
    } else {
      await client.chat.postEphemeral({
        token: process.env.SLACK_BOT_TOKEN,
        channel: command.channel_id,
        attachments: [
          { text: `${t("TEXTUSE")} '${t("COMMANDLIST")} ${t("TEXTPUBLIC")}` },
        ],
        text: returnText,
        user: command.user_id,
      });
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDLIST")}: ${error}`,
    );
  }
}

async function status({ command, ack, say }) {
  ack();
  try {
    const state = await queries.getGameState();
    let returnText = `${t("TEXTGAMESTOPPED")}`;
    if (state.length > 0) {
      returnText = `${t("TEXTSTATUSGAME")}\n\n`;
      for (let i = 0; i < state.length; i++) {
        returnText += formatStatusLine(state[i], i);
      }
      const enrolledGames = await queries.getActiveGameUser(command.user_id);
      returnText = appendEnrolledGames(returnText, enrolledGames);
    }
    await postStatusResponse(command, returnText, say);
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDSTATUS")}: ${error}`,
    );
  }
}

async function archive({ command, ack, say }) {
  ack();
  try {
    const params = command.text.trim().split(" ");
    if (params.length < 1) {
      const warning = `${t("TEXTTWOPARAMETERs")} ${t("COMMANDARCHIVE")} [${t("TEXTPASSWORD")}] [${t("TEXTGAMENAME")}]`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (params[0] !== process.env.MNOT_ADMIN_PASS) {
      const warning = `${t("TEXTINCORRECTPASSWORD")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const game = await queries.getGameName(params[1]);
    const channelList = await queries.getAllChannels(game.gms_id);
    for (const oneChannel of channelList) {
      try {
        await client.conversations.archive({
          token: process.env.SLACK_BOT_TOKEN,
          channel: oneChannel.gch_slack_id,
        });
      } catch (error) {
        await helpers.sendIM(
          client,
          command.user_id,
          `${t("TEXTARCHIVEERROR")}: ${oneChannel.gch_name} (${error}`,
        );
      }
    }
    await helpers.sendIM(
      client,
      command.user_id,
      `${game.gms_name} ${t("TEXTARCHIVED")}`,
    );
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDARCHIVE")}: ${error}`,
    );
  }
}

async function startVoteRound({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    if (!(await queries.isModerator(game.gms_id, command.user_id))) {
      const warning = `${t("TEXTSTARTVOTEROUNDMODERATOR")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const channelId = await queries.getChannel(
      game.gms_id,
      helpers.channelType.vote,
    );
    const channelUsersList = await helpers.getUserlist(client, channelId);
    await queries.startPoll(game.gms_id, command.text.trim() || " ");
    const playersAlive = await queries.getAlive(game.gms_id);
    const channelUsersAlive = channelUsersList.filter((x) =>
      playersAlive.map((y) => y.user_id).includes(x.id),
    );

    const chuckedUsersAlive = [];
    while (channelUsersAlive.length) {
      chuckedUsersAlive.push(channelUsersAlive.splice(0, 5));
    }

    let buttonblocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: command.text.trim() || " ",
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
    const message = await client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      text: command.text.trim() || " ",
      blocks: buttonblocks,
    });
    await queries.setMessageIdPoll(game.gms_id, message);
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDVOTEROUND")}: ${error}`,
    );
  }
}

async function stopVoteRound({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    if (!(await queries.isModerator(game.gms_id, command.user_id))) {
      const warning = `${t("TEXTSTOPGAMEROUNDMODERATOR")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const voteChannelId = await queries.getChannel(
      game.gms_id,
      helpers.channelType.vote,
    );
    const channelUsersList = await helpers.getUserlist(client, voteChannelId);
    const playersAlive = await queries.getAlive(game.gms_id);
    const channelUsersAlive = filterAliveChannelUsers(
      channelUsersList,
      playersAlive,
    );

    const poll = await queries.stopPoll(game.gms_id);
    const pollResults = await queries.getPollResults(poll);
    const pollMessage = splitSlackMessageId(poll.gpo_slack_message_id);
    await client.chat.update({
      token: process.env.SLACK_BOT_TOKEN,
      channel: pollMessage.channelId,
      ts: pollMessage.messageTs,
      text: `${poll.gpo_title} ${t("TEXTCLOSED")}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${poll.gpo_title} ${t("TEXTCLOSED")}`,
          },
        },
      ],
    });
    const mayorId = channelUsersAlive
      .filter((x) => x.status === t("TEXTMAYOR"))
      .map((y) => y.id)
      .join();
    const pollStats = buildPollStats(pollResults, mayorId);
    applyPollStats(channelUsersAlive, pollStats);
    helpers.shuffle(channelUsersAlive);
    helpers.postDelayed(client, pollMessage.channelId, channelUsersAlive);
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDSTOPVOTEROUND")}: ${error}`,
    );
  }
}

async function voteReminder({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    if (!(await queries.isModerator(game.gms_id, command.user_id))) {
      const warning = `${t("TEXTMODERATORVOTEREMINDER")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const playersNotVoted = await queries.getAliveNotVoted(game.gms_id);
    const message = `${t("TEXTNOTVOTEDTIME")} ${command.text.trim()} om te stemmen, stemmen is verplicht`;
    for (const player of playersNotVoted) {
      await helpers.sendIM(client, player.user_id, message);
    }
    await helpers.sendIM(
      client,
      command.user_id,
      `${playersNotVoted.length} stemherinneringen verstuurd`,
    );
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDREMINDER")}: ${error}`,
    );
  }
}

async function voteScore({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    if (!(await queries.isSectator(game.gms_id, command.user_id))) {
      const warning = `${t("TEXTMODERATORVOTESCORE")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    // tijdelijk uitschakelen stemstand
    // if (!(await queries.isModerator(game.gms_id, command.user_id))) {
    //   const warning = `sorry sectators op verzoek van de vertellers staat wwstemstand uit`;
    //   await helpers.sendIM(client, command.user_id, warning);
    //   return;
    // }
    const voteChannelId = await queries.getChannel(
      game.gms_id,
      helpers.channelType.vote,
    );
    const channelUsersList = await helpers.getUserlist(client, voteChannelId);
    const playersAlive = await queries.getAlive(game.gms_id);
    const channelUsersAlive = filterAliveChannelUsers(
      channelUsersList,
      playersAlive,
    );

    const mayorId = channelUsersAlive
      .filter((x) => x.status === t("TEXTMAYOR"))
      .map((y) => y.id)
      .join();

    const prelimResult = await queries.getCurrentPollResults(
      game.gms_id,
      mayorId,
    );
    if (!prelimResult.length) {
      return await helpers.sendIM(
        client,
        command.user_id,
        `${t("TEXTNOVOTES")}`,
      );
    }
    const voteLines = prelimResult.map(
      (resultLine) =>
        `${t("TEXTVOTESON")} <@${resultLine.votee}>: *${resultLine.votes}*`,
    );
    await helpers.sendIM(client, command.user_id, voteLines.join("\n"));
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDVOTESCORE")}: ${error}`,
    );
  }
}

async function startQuickVoteRound({ command, ack, say }) {
  ack();
  try {
    const gameId = await queries.getActiveGameWithChannel(command.channel_id);
    let playersAlive = await queries.getAlive(gameId.gms_id);
    playersAlive = await helpers.addSlackName(client, playersAlive);
    const chuckedUsersAlive = [];
    while (playersAlive.length) {
      chuckedUsersAlive.push(playersAlive.splice(0, 5));
    }

    let buttonblocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${t("TEXTQUICKVOTE")}:`,
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
              text: x.slack_name,
            },
            value: x.user_id,
            action_id: `vluchtig-${x.user_id}`,
          })),
        },
      ]);
    buttonblocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: `${t("TEXTCLOSEQUICKVOTE")}`,
          },
          value: `sluit`,
          action_id: `vluchtig-sluit`,
        },
      ],
    });
    await client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: command.channel_id,
      text: `${t("TEXTQUICKVOTE")}:`,
      blocks: buttonblocks,
    });
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDSTARTQUICKVOTE")}: ${error}`,
    );
  }
}

async function startRegistration({ command, ack, say }) {
  ack();
  try {
    const params = command.text.trim().split(" ");
    if (params.length !== 3) {
      const warning = `${t("TEXTTHREEPARAMETERSNEEDED")} ${t("COMMANDSTARTREGISTRATION")} [${t("TEXTPASSWORD")}] [${t(
        "TEXTVOTESTYLE",
      )}] [${t("TEXTREVIVEABLE")}]`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (params[0] !== process.env.MNOT_ADMIN_PASS) {
      const warning = `${t("TEXTINCORRECTPASSWORDSTARTGAME")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (params[1] !== t("TEXTBLIND")) {
      const warning = `${t("TEXTINCORRECTVOTESTYLE")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const lastGameName = await queries.getLastGameName();
    const gameName = `ww${Number.parseInt(lastGameName[0].gms_name.substring(2), 10) + 1}`;
    const userName = await helpers.getUserName(client, command.user_id);
    const result = await queries.createNewGame(
      params[1],
      gameName,
      params[2],
      command.user_id,
      userName,
    );
    if (result.succes) {
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: process.env.REG_CHANNEL || command.channel_id,
        text: `${t("TEXTREGISTRATIONSGAME")} (${result.gameName}) ${t("TEXTAREOPENED")} ${t(
          "COMMANDIWILLJOIN",
        )} ${t("TEXTSUBSCRIBE")} ${t("COMMANDIWILLVIEW")} ${t("TEXTVIEW")}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${t("TEXTREGISTRATIONSGAME")} (${result.gameName}) ${t("TEXTAREOPENED")} ${t(
                "COMMANDIWILLJOIN",
              )} ${t("TEXTSUBSCRIBE")} ${t("COMMANDIWILLVIEW")} ${t("TEXTVIEW")}`,
            },
          },
        ],
      });
    } else {
      await helpers.sendIM(client, command.user_id, result.error);
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDSTARTREGISTRATION")}: ${error}`,
    );
  }
}

async function startGameCommand({ command, ack, say }) {
  ack();
  try {
    const params = command.text.trim().split(" ");
    if (params.length !== 3) {
      const warning = `${t("TEXTTHREEPARAMETERSNEEDED")} ${t("COMMANDSTARTGAME")} [${t("TEXTGAMENAME")}] [${t(
        "TEXTPLAYERAMOUNT",
      )}] [${t("TEXTNAMEMAINCHANNEL")}] ${t("TEXTUSESTATUS")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const game = await queries.getGameName(params[0]);
    if (!(await queries.isModerator(game.gms_id, command.user_id))) {
      const warning = `${t("TEXTMODERATORSTARTGAME")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    let channelName;
    const regexName = /^ww\d.*/;
    if (regexName.test(params[2]) === false) {
      channelName = `${game.gms_name.toLowerCase().split(" ").join("_")}_${params[2].toLowerCase()}`;
    } else {
      channelName = params[2].toLowerCase();
    }

    const result = await queries.startGame(game.gms_id, params[1]);

    const mainChannel = await helpers.createOrGetPrivateChannel(
      client,
      channelName,
    );

    const spectatorsChannel = await helpers.createOrGetPrivateChannel(
      client,
      `${game.gms_name.toLowerCase().split(" ").join("_")}_${t("TEXTSPECTATORS")}`,
    );

    const voteBoothChannel = await helpers.createOrGetPrivateChannel(
      client,
      `${game.gms_name.toLowerCase().split(" ").join("_")}_${t("TEXTVOTEBOOTH")}`,
    );

    const voteFlowChannel = await helpers.createOrGetPrivateChannel(
      client,
      `${game.gms_name.toLowerCase().split(" ").join("_")}_${t("TEXTVOTEFLOW")}`,
    );

    const wolvesChannel = await helpers.createOrGetPrivateChannel(
      client,
      `${game.gms_name.toLowerCase().split(" ").join("_")}_${t("TEXTWOLFCHANNEL")}`,
    );

    const talkChannel = await helpers.createOrGetPrivateChannel(
      client,
      `${game.gms_name.toLowerCase().split(" ").join("_")}_${t("TEXTTALKCHANNEL")}`,
    );

    const spoilerChannel = await helpers.createOrGetPrivateChannel(
      client,
      `${game.gms_name.toLowerCase().split(" ").join("_")}_${t("TEXTSPOILERCHANNEL")}`,
    );

    if (result.succes) {
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: mainChannel.channel.id,
        users: result.playerList.map((x) => x.gpl_slack_id).join(","),
      });
      const mainChannelInput = {
        gch_gms_id: game.gms_id,
        gch_slack_id: mainChannel.channel.id,
        gch_name: mainChannel.channel.name,
        gch_type: helpers.channelType.main,
        gch_user_created: command.user_id,
      };
      await queries.logChannel(mainChannelInput);
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: voteBoothChannel.channel.id,
        users: result.playerList.map((x) => x.gpl_slack_id).join(","),
      });
      const voteBoothChannelInput = {
        gch_gms_id: game.gms_id,
        gch_slack_id: voteBoothChannel.channel.id,
        gch_name: voteBoothChannel.channel.name,
        gch_type: helpers.channelType.vote,
        gch_user_created: command.user_id,
      };
      await queries.logChannel(voteBoothChannelInput);
      const voteFlowChannelInput = {
        gch_gms_id: game.gms_id,
        gch_slack_id: voteFlowChannel.channel.id,
        gch_name: voteFlowChannel.channel.name,
        gch_type: helpers.channelType.stemstand,
        gch_user_created: command.user_id,
      };
      await queries.logChannel(voteFlowChannelInput);
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: mainChannel.channel.id,
        users: result.viewerList.map((x) => x.gpl_slack_id).join(","),
      });
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: voteBoothChannel.channel.id,
        users: result.viewerList.map((x) => x.gpl_slack_id).join(","),
      });
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: voteFlowChannel.channel.id,
        users: result.vertellerList.map((x) => x.gpl_slack_id).join(","),
      });
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: spectatorsChannel.channel.id,
        users: result.viewerList.map((x) => x.gpl_slack_id).join(","),
      });

      const spectatorInput = {
        gch_gms_id: game.gms_id,
        gch_slack_id: spectatorsChannel.channel.id,
        gch_name: spectatorsChannel.channel.name,
        gch_type: helpers.channelType.sectator,
        gch_user_created: command.user_id,
      };
      await queries.logChannel(spectatorInput);

      // Invite everyone to the talking channel
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: talkChannel.channel.id,
        users: result.viewerList.map((x) => x.gpl_slack_id).join(","),
      });
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: talkChannel.channel.id,
        users: result.playerList.map((x) => x.gpl_slack_id).join(","),
      });
      const talkChannelInput = {
        gch_gms_id: game.gms_id,
        gch_slack_id: talkChannel.channel.id,
        gch_name: talkChannel.channel.name,
        gch_type: helpers.channelType.talking,
        gch_user_created: command.user_id,
      };
      await queries.logChannel(talkChannelInput);

      // Only invite the narrators to the spoiler channel
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: spoilerChannel.channel.id,
        users: result.vertellerList.map((x) => x.gpl_slack_id).join(","),
      });
      const spoilerChannelInput = {
        gch_gms_id: game.gms_id,
        gch_slack_id: spoilerChannel.channel.id,
        gch_name: spoilerChannel.channel.name,
        gch_type: helpers.channelType.spoilers,
        gch_user_created: command.user_id,
      };
      await queries.logChannel(spoilerChannelInput);

      // Invite the narrators to the wolf channel, inviting the wolves still happens manually
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: wolvesChannel.channel.id,
        users: result.vertellerList.map((x) => x.gpl_slack_id).join(","),
      });
      const wolvesChannelInput = {
        gch_gms_id: game.gms_id,
        gch_slack_id: wolvesChannel.channel.id,
        gch_name: wolvesChannel.channel.name,
        gch_type: helpers.channelType.wolves,
        gch_user_created: command.user_id,
      };
      await queries.logChannel(wolvesChannelInput);

      const notSelectedMessage = `${t("TEXTNOTINGAME")}`;
      const notSelectedPlayers = await queries.getNotDrawnPlayers(game.gms_id);
      for (const player of notSelectedPlayers) {
        await helpers.sendIM(client, player.gpl_slack_id, notSelectedMessage);
      }
      let returnText = [];
      const usersList = await helpers.getUserlist(
        client,
        mainChannel.channel.id,
      );
      for (const player of result.playerList) {
        const foundUser = usersList.find(
          (user) => user.id === player.gpl_slack_id,
        );
        if (foundUser) {
          returnText += `${foundUser.name}\n`;
        }
      }
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: mainChannel.channel.id,
        text: `${params[0]} ${t("TEXTGAMESTARTEDREGISTRATION")} ${returnText}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${params[0]} ${t("TEXTGAMESTARTEDREGISTRATION")} ${returnText}`,
            },
          },
        ],
      });
    } else {
      await helpers.sendIM(client, command.user_id, result.error);
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDSTARTGAME")}: ${error}`,
    );
  }
}

async function stopGameCommand({ command, ack, say }) {
  ack();
  try {
    const params = command.text.trim().split(" ");
    if (params.length < 1) {
      const warning = `${t("TEXTTWODPARAMETERS")} ${t("COMMANDSTOPGAME")} [${t("TEXTPASSWORD")}] [${t(
        "TEXTGAMENAME",
      )}]`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const game = await queries.getGameName(params[1]);

    if (params[0] !== process.env.MNOT_ADMIN_PASS) {
      const warning = `${t("TEXTPASSWORDNEEDEDSTOPGAME")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (!(await queries.isModerator(game.gms_id, command.user_id))) {
      const warning = `${t("TEXTMODERATORSTOPGAME")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const result = await queries.stopGame(game.gms_id);
    if (result.succes) {
      const allChannels = await queries.getAllChannels(game.gms_id);
      const channelId = await queries.getChannel(
        game.gms_id,
        helpers.channelType.vote,
      );
      const chuckedChannels = [];
      while (allChannels.length) {
        chuckedChannels.push(allChannels.splice(0, 5));
      }

      let buttonblocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${t("TEXTCLICKSELFINVITECHANNELS")}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: t("TEXTALLCHANNELS"),
              },
              value: `allchannels-${game.gms_id}`,
              action_id: `selfinvite-allchannels-${game.gms_id}`,
            },
          ],
        },
      ];
      for (const channelChunk of chuckedChannels)
        buttonblocks = buttonblocks.concat([
          {
            type: "actions",
            elements: channelChunk.map((x) => ({
              type: "button",
              text: {
                type: "plain_text",
                text: x.gch_name,
              },
              value: x.gch_slack_id,
              action_id: `selfinvite-${x.gch_slack_id}`,
            })),
          },
        ]);
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: channelId,
        text: `${t("TEXTCLICKSELFINVITECHANNELS")}`,
        blocks: buttonblocks,
      });

      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: process.env.REG_CHANNEL || command.channel_id,
        text: `${game.gms_name} ${t("TEXTGAMECLOSED")}`,
      });

      await helpers.sendIM(
        client,
        command.user_id,
        `${game.gms_name} ${t("TEXTGAMECLOSED")}`,
      );
    } else {
      await helpers.sendIM(client, command.user_id, result.error);
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDSTOPGAME")}: ${error}`,
    );
  }
}

async function createChannel({ command, ack, say }) {
  ack();
  try {
    const games = await queries.getActiveGameUser(command.user_id);
    const params = command.text.trim().split(" ");
    if (params.length !== 1) {
      const warning = `${t("TEXTONEPARAMETERNEEDED")} ${t("COMMANDCREATECHANNEL")} [${t("TEXTNAMECHANNEL")}]`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (games.length == 1) {
      await actions.createNewChannelFunction(
        games[0].gms_id,
        command.user_id,
        params[0],
        0,
        0,
        true,
      );
    } else if (games.length > 0) {
      const im = await client.conversations.open({
        token: process.env.SLACK_BOT_TOKEN,
        users: command.user_id,
      });
      let buttonElements = [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: `${t("TEXTCLOSEMESSAGE")}`,
          },
          value: "Close",
          action_id: `delete-${command.channel_id}`,
        },
      ];
      for (const game of games) {
        buttonElements.push({
          type: "button",
          text: {
            type: "plain_text",
            text: game.gms_name,
          },
          value: params[0].toString(),
          action_id: `kanaal-${game.gms_id}`,
        });
      }
      let buttonblocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKCHANNEL")}`,
          },
        },
        {
          type: "actions",
          elements: buttonElements,
        },
      ];
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: im.channel.id,
        text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKCHANNEL")}`,
        blocks: buttonblocks,
      });
    } else {
      throw new Error("Je doet niet mee aan een actief spel");
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDCREATECHANNEL")}: ${error}`,
    );
  }
}

async function markDead({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    const params = command.text.trim().split(" ");
    if (!(await queries.isModerator(game.gms_id, command.user_id))) {
      const warning = t(`TEXTKILLPEOPLE`);
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (params.length !== 1) {
      const warning = `${t("COMMANDDEAD")} ${t("TEXTONEPARAMETER")} [@${t("TEXTUSER")}]`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (/^<(@[A-Z0-9]*)(\|.*)?>/.test(params[0]) === false) {
      const warning = `${t("TEXTFIRSTPARAMETERSHOULD")} ${t("COMMANDDEAD")} ${t("TEXTSHOULDBEA")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }

    const userId = params[0].match(/^<@([A-Z0-9]*)(\|.*)?>/)[1];
    const channelId = await queries.getChannel(
      game.gms_id,
      helpers.channelType.sectator,
    );
    await queries.killUser(game.gms_id, userId);
    const message = `${t("TEXTYOUDIED")} ${t("TEXTDEAD")}? ${t("TEXTINVITEDAFTERLIFE")}`;
    await helpers.sendIM(client, userId, message);
    await client.conversations.invite({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      users: userId,
    });
    await helpers.sendIM(
      client,
      command.user_id,
      `${params[0]} is ${t("TEXTDEAD")}`,
    );
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDDEAD")}: ${error}`,
    );
  }
}

async function revive({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    const params = command.text.trim().split(" ");
    if (!(await queries.isModerator(game.gms_id, command.user_id))) {
      const warning = `${t("TEXTMODERATORREVIVE")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (params.length !== 1) {
      const warning = `${t("COMMANDREVIVE")} ${t("TEXTONEPARAMETER.")} [@${t("TEXTUSER")}]`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (/^<(@[A-Z0-9]*)(\|.*)?>/.test(params[0]) === false) {
      const warning = `${t("TEXTFIRSTPARAMETER")} ${t("COMMANDREVIVE")} ${t("TEXTSHOULDBEA")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }

    const userId = params[0].match(/^<@([A-Z0-9]*)(\|.*)?>/)[1];
    await queries.reanimateUser(game.gms_id, userId);
    const message = `${t("TEXTRERISE")}`;
    await helpers.sendIM(client, userId, message);
    await helpers.sendIM(
      client,
      command.user_id,
      `${params[0]} is ${t("TEXTALIVE")}`,
    );
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDREVIVE")}: ${error}`,
    );
  }
}

async function addExtraModerator({ command, ack, say }) {
  ack();
  try {
    const params = command.text.trim().split(" ");
    if (params.length !== 1) {
      const warning = `${t("COMMANDEXTRAMODERATOR")} ${t("TEXTONEPARAMETER")} [@${t("TEXTUSER")}]`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    if (/^<(@[A-Z0-9]*)(\|.*)?>/.test(params[0]) === false) {
      const warning = `${t("TEXTFIRSTPARAMETERSHOULD")} ${t("COMMANDEXTRAMODERATOR")} ${t("TEXTSHOULDBEA")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const moderatorId = params[0].match(/^<@([A-Z0-9]*)(\|.*)?>/)[1];
    const games = await queries.getGameModerator(command.user_id, moderatorId);
    if (games.length == 1) {
      await actions.addModeratorFunction(
        moderatorId,
        command.user_id,
        process.env.REG_CHANNEL || command.channel_id,
        games[0].gms_id,
        0,
        0,
        true,
      );
    } else if (games.length > 0) {
      const im = await client.conversations.open({
        token: process.env.SLACK_BOT_TOKEN,
        users: command.user_id,
      });
      let buttonElements = [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: `${t("TEXTCLOSEMESSAGE")}`,
          },
          value: "Close",
          action_id: `delete-${command.channel_id}`,
        },
      ];
      for (const game of games) {
        buttonElements.push({
          type: "button",
          text: {
            type: "plain_text",
            text: game.gms_name,
          },
          value: moderatorId,
          action_id: `verteller-${game.gms_id}`,
        });
      }
      let buttonblocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKVERTELLER")}`,
          },
        },
        {
          type: "actions",
          elements: buttonElements,
        },
      ];
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: im.channel.id,
        text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKVERTELLER")}`,
        blocks: buttonblocks,
      });
    } else {
      await helpers.sendIM(
        client,
        command.user_id,
        `${t("TEXTONLYMODSCANMAKEMODS")}`,
      );
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDEXTRAMODERATOR")}: ${error}`,
    );
  }
}

async function inviteModerators({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameUser(command.user_id);
    const moderators = await queries.getModerators(game[0].gms_id);
    const channelUsersList = await helpers.getUserlist(
      client,
      command.channel_id,
    );
    const usersToInvite = moderators.filter(
      (x) => !channelUsersList.map((y) => y.id).includes(x),
    );
    if (usersToInvite.length > 0) {
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: command.channel_id,
        users: usersToInvite.join(),
      });
      const channelInput = {
        gch_gms_id: game[0].gms_id,
        gch_slack_id: command.channel_id,
        gch_name: command.channel_name,
        gch_type: helpers.channelType.standard,
        gch_user_created: command.user_id,
      };
      await queries.logChannel(channelInput);
    } else {
      await helpers.sendIM(
        client,
        command.user_id,
        `${t("TEXTALLMODERATORSINVITED")}`,
      );
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDINVITEMODERATOR")}: ${error}`,
    );
  }
}

async function invitePlayers({ command, ack, say }) {
  ack();
  const params = command.text.trim().split(" ");
  try {
    if (params[0] !== "ikweethetzeker") {
      const warning = `${t("TEXTBESURE")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    const players = await queries.getEveryOne(game.gms_id);
    const channelUsersList = await helpers.getUserlist(
      client,
      command.channel_id,
    );
    const usersToInvite = players.filter(
      (x) => !channelUsersList.map((y) => y.id).includes(x.user_id),
    );
    if (usersToInvite.length > 0) {
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: command.channel_id,
        users: usersToInvite.map((x) => x.user_id).join(),
      });
    } else {
      await helpers.sendIM(client, command.user_id, `${t("TEXTALLINVITED")}`);
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDINVITEPLAYERS")}: ${error}`,
    );
  }
}

async function iWillJoin({ command, ack, say }) {
  ack();
  try {
    const games = await queries.getGameRegisterUser(command.user_id);
    if (games.length == 1) {
      await actions.joinActionFunction(
        command.user_id,
        games[0].gms_id,
        0,
        0,
        true,
      );
    } else if (games.length > 0) {
      const im = await client.conversations.open({
        token: process.env.SLACK_BOT_TOKEN,
        users: command.user_id,
      });
      let buttonElements = [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: `${t("TEXTCLOSEMESSAGE")}`,
          },
          value: "Close",
          action_id: `delete-${command.channel_id}`,
        },
      ];
      for (const game of games) {
        buttonElements.push({
          type: "button",
          text: {
            type: "plain_text",
            text: game.gms_name,
          },
          value: game.gms_id.toString(),
          action_id: `inschrijven-${game.gms_id}`,
        });
      }
      let buttonblocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKREGISTER")}`,
          },
        },
        {
          type: "actions",
          elements: buttonElements,
        },
      ];
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: im.channel.id,
        text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKREGISTER")}`,
        blocks: buttonblocks,
      });
    } else {
      await helpers.sendIM(
        client,
        command.user_id,
        `${t("TEXTNOREGISTRATION")}`,
      );
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDIWILLJOIN")}: ${error}`,
    );
  }
}

async function iWillView({ command, ack, say }) {
  ack();
  try {
    const games = await queries.getGameOpenUser(command.user_id);
    if (games.length == 1) {
      await actions.viewActionFunction(
        command.user_id,
        games[0].gms_id,
        0,
        0,
        true,
      );
    } else if (games.length > 0) {
      const im = await client.conversations.open({
        token: process.env.SLACK_BOT_TOKEN,
        users: command.user_id,
      });
      let buttonElements = [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: `${t("TEXTCLOSEMESSAGE")}`,
          },
          value: "Close",
          action_id: `delete-${command.channel_id}`,
        },
      ];
      for (const game of games) {
        buttonElements.push({
          type: "button",
          text: {
            type: "plain_text",
            text: game.gms_name,
          },
          value: game.gms_id.toString(),
          action_id: `meekijken-${game.gms_id}`,
        });
      }
      let buttonblocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKVIEW")}`,
          },
        },
        {
          type: "actions",
          elements: buttonElements,
        },
      ];
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: im.channel.id,
        text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKVIEW")}`,
        blocks: buttonblocks,
      });
    } else {
      await helpers.sendIM(
        client,
        command.user_id,
        `${t("TEXTCOMMANDERROR")} ${t("COMMANDIWILLVIEW")}: ${t("TEXTNOREGISTRATION")}`,
      );
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDIWILLVIEW")}: ${error}`,
    );
  }
}

async function iWillNotJoinAnymore({ command, ack, say }) {
  ack();
  try {
    const games = await queries.getGameUnregisterUser(command.user_id);
    if (games.length == 1) {
      await actions.unregisterActionFunction(
        command.user_id,
        games[0].gms_id,
        0,
        0,
        true,
      );
    } else if (games.length > 0) {
      const im = await client.conversations.open({
        token: process.env.SLACK_BOT_TOKEN,
        users: command.user_id,
      });
      let buttonElements = [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: `${t("TEXTCLOSEMESSAGE")}`,
          },
          value: "Close",
          action_id: `delete-${command.channel_id}`,
        },
      ];
      for (const game of games) {
        buttonElements.push({
          type: "button",
          text: {
            type: "plain_text",
            text: game.gms_name,
          },
          value: game.gms_id.toString(),
          action_id: `uitschrijven-${game.gms_id}`,
        });
      }
      let buttonblocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKVIEW")}`,
          },
        },
        {
          type: "actions",
          elements: buttonElements,
        },
      ];
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: im.channel.id,
        text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKVIEW")}`,
        blocks: buttonblocks,
      });
    } else {
      await helpers.sendIM(
        client,
        command.user_id,
        `${t("TEXTCOMMANDERROR")} ${t("COMMANDREMOVEYOURSELFFROMGAME")}: ${t("TEXTNOTENROLLED")}`,
      );
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDREMOVEYOURSELFFROMGAME")}: ${error}`,
    );
  }
}

async function assignRoles({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    if (!(await queries.isModerator(game.gms_id, command.user_id))) {
      const warning = `${t("TEXTONLYMODERATORROLES")}`;
      await helpers.sendIM(client, command.user_id, warning);
      return;
    }
    const params = command.text.trim().split(" ");
    const playersAlive = await queries.getAlive(game.gms_id);
    helpers.shuffle(playersAlive);
    let neededRoles = playersAlive.length;
    let playerIndex = 0;
    const optionals = [];

    for (const roleDefinition of params) {
      const roleConfig = parseRoleDefinition(roleDefinition, neededRoles);
      neededRoles = roleConfig.nextNeededRoles;
      playerIndex = assignMandatoryRoles(
        playersAlive,
        roleConfig.roleName,
        roleConfig.mandatoryCount,
        playerIndex,
      );
      addOptionalRoles(
        optionals,
        roleConfig.roleName,
        roleConfig.optionalCount,
      );
    }

    helpers.shuffle(optionals);
    assignOptionalRoles(playersAlive, optionals);

    const roleList = [];
    for (const player of playersAlive) {
      await helpers.sendIM(
        client,
        player.user_id,
        `${t("TEXTHI")} <@${player.user_id}>, ${t("TEXTYOURROLE")} ${player.rol}`,
      );
      roleList.push(`<@${player.user_id}>: ${player.rol}`);
    }
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTROLES")}:\n${roleList.join("\n")}`,
    );
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDGIVEROLES")}: ${error}`,
    );
  }
}

async function help({ command, ack, say }) {
  ack();
  try {
    const helpText = `${t("HELPTEXT")}`;
    await helpers.sendIM(client, command.user_id, helpText);
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDHELP")}: ${error}`,
    );
  }
}

async function lotto({ command, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(command.channel_id);
    const playersAlive = await queries.getAlive(game.gms_id);
    helpers.shuffle(playersAlive);
    if (playersAlive.length) {
      if (command.text.trim() === "public") {
        say({
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${t("TEXTIFIVOTE")} <@${playersAlive[0].user_id}>\n(${t("TEXTREMARK")}!)`,
              },
            },
          ],
        });
      } else {
        await client.chat.postEphemeral({
          token: process.env.SLACK_BOT_TOKEN,
          channel: command.channel_id,
          attachments: [
            {
              text: `${t("TEXTUSE")} '${t("COMMANDLOTTO")} ${t("TEXTPUBLIC")}`,
            },
          ],
          text: `${t("TEXTIFIVOTE")} <@${playersAlive[0].user_id}>\n(${t("TEXTREMARK")}!)`,
          user: command.user_id,
        });
      }
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDLOTTO")}: ${error}`,
    );
  }
}

async function summarize({ command, ack, say }) {
  ack();

  try {
    const { startDate, endDate } = parseSummaryDateRange(command.text);

    const threads = await queries.threadIdsInChannelByDate(
      command.channel_id,
      startDate,
      endDate,
    );
    const threadIds = new Set(threads.map((x) => x.gpm_thread_ts));

    const ntMessages = await queries.nonThreadedMessagesInChannelByDate(
      command.channel_id,
      startDate,
      endDate,
    );

    const summary = [];
    let lastUser = null;
    let lastTime = new Date(0);

    for (const message of ntMessages) {
      const newTime = new Date(message.gpm_created_at);
      if (message.gpl_name !== lastUser || newTime - lastTime > 1 * 60 * 1000) {
        lastUser = message.gpl_name;
        lastTime = newTime;
        addSummaryHeader(summary, message, newTime);
      }
      addSummaryText(summary, message);
      addSummaryFiles(summary, message.gpm_files);
      if (threadIds.has(message.gpm_slack_ts)) {
        await addThreadedSummary(
          summary,
          command.channel_id,
          message.gpm_slack_ts,
        );
      }
    }

    await postSummaryInChunks(summary, say);
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDSUMMARIZE")}: ${error}`,
    );
  }
}

async function whoIsPlaying({ command, ack, say }) {
  ack();
  try {
    const state = await queries.getEnrollment();
    let returnText = `${t("TEXTNOREGISTRATION")}`;
    if (state.length > 0) {
      const groupedByGame = state.reduce((acc, row) => {
        if (!acc[row.game]) {
          acc[row.game] = [];
        }
        acc[row.game].push(row);
        return acc;
      }, {});

      const gameLines = Object.entries(groupedByGame).map(
        ([gameName, rows]) => {
          const statusLines = rows.map((row) => {
            const players = row.players
              ? row.players
                  .split(",")
                  .filter(Boolean)
                  .map((playerId) => `<@${playerId.trim()}>`)
                  .join(", ")
              : "-";
            return `  - ${row.status}: ${players}`;
          });
          return `*${gameName}*\n${statusLines.join("\n")}`;
        },
      );
      returnText = `${t("TEXTALLGAMES")}\n${gameLines.join("\n")}`;
    }

    if (command.text.trim() === "public") {
      say({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: returnText,
            },
          },
        ],
      });
    } else {
      await client.chat.postEphemeral({
        token: process.env.SLACK_BOT_TOKEN,
        channel: command.channel_id,
        attachments: [
          {
            text: `${t("TEXTUSE")} ${t("COMMANDWHOISPLAYING")} ${t("TEXTPUBLIC")}`,
          },
        ],
        text: returnText,
        user: command.user_id,
      });
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      command.user_id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDWHOISPLAYING")}: ${error}`,
    );
  }
}
