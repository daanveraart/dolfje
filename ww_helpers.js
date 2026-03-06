const channelType = {
  main: "MAIN",
  vote: "VOTE",
  sectator: "SECTATOR",
  standard: "NORMAL",
  stemstand: "VOTEFLOW",
  wolves: "WOLVES",
  talking: "TALKING",
  spoilers: "SPOILERS",
};

module.exports = {
  getUserlist,
  getUserName,
  sendIM,
  shuffle,
  postDelayed,
  addSlackName,
  inviteEveryone,
  createOrGetPrivateChannel,
  channelType,
};

async function createOrGetPrivateChannel(client, channelName) {
  try {
    const created = await client.conversations.create({
      token: process.env.SLACK_BOT_TOKEN,
      name: channelName,
      is_private: true,
    });
    return created;
  } catch (error) {
    const slackError = error?.data?.error || error?.error;
    if (slackError !== "name_taken") {
      throw error;
    }

    let cursor;
    do {
      const response = await client.conversations.list({
        token: process.env.SLACK_BOT_TOKEN,
        types: "private_channel",
        exclude_archived: false,
        limit: 1000,
        cursor,
      });

      const existing = response.channels.find(
        (channel) => channel.name === channelName,
      );
      if (existing) {
        return {
          ok: true,
          channel: {
            id: existing.id,
            name: existing.name,
          },
        };
      }
      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    throw error;
  }
}

async function getUserlist(client, channelId) {
  const channelUsersList = [];
  const conversationsMembers = await client.conversations.members({
    token: process.env.SLACK_BOT_TOKEN,
    channel: channelId,
  });

  const usersList = await client.users.list({
    token: process.env.SLACK_BOT_TOKEN,
  });
  for (const user of usersList.members) {
    if (conversationsMembers.members.includes(user.id) && !user.is_bot) {
      channelUsersList.push({
        id: user.id,
        name:
          user.profile.display_name_normalized ||
          user.profile.real_name_normalized,
        status: user.profile.status_text,
        votedBy: [],
      });
    }
  }
  return channelUsersList;
}

async function getUserName(client, userId) {
  const usersList = await client.users.list({
    token: process.env.SLACK_BOT_TOKEN,
  });
  for (const user of usersList.members) {
    if (userId === user.id) {
      return (
        user.profile.display_name_normalized ||
        user.profile.real_name_normalized
      );
    }
  }
}

async function addSlackName(client, userArray) {
  const resultArray = [];
  const usersList = await client.users.list({
    token: process.env.SLACK_BOT_TOKEN,
  });
  for (const member of usersList.members) {
    for (const user of userArray) {
      if (member.id === user.user_id) {
        user.slack_name =
          member.profile.display_name_normalized ||
          member.profile.real_name_normalized;
        resultArray.push(user);
      }
    }
  }
  return resultArray;
}

async function inviteEveryone(client, command, game, queries, t, allChannels) {
  if (!allChannels.length) {
    return;
  }
  const singleChannel = allChannels.pop();
  try {
    const players = await queries.getEveryOne(game.gms_id);
    const channelUsersList = await getUserlist(
      client,
      singleChannel.gch_slack_id,
    );
    const usersToInvite = players.filter(
      (x) => !channelUsersList.map((y) => y.id).includes(x.user_id),
    );
    if (usersToInvite.length) {
      await client.conversations.invite({
        token: process.env.SLACK_BOT_TOKEN,
        channel: singleChannel.gch_slack_id,
        users: usersToInvite.map((x) => x.user_id).join(","),
      });
    } else {
      await sendIM(
        client,
        command.user_id,
        `${singleChannel.gch_name}: ${t("TEXTALLINVITED")}`,
      );
    }
  } catch (err) {
    await sendIM(
      client,
      command.user_id,
      `invite into ${singleChannel.gch_name} failed: ${err.stack}`,
    );
  } finally {
    setTimeout(
      () => inviteEveryone(client, command, game, queries, t, allChannels),
      15000,
    );
  }
}

async function sendIM(client, userId, message) {
  const im = await client.conversations.open({
    token: process.env.SLACK_BOT_TOKEN,
    users: userId,
  });
  await client.chat.postMessage({
    token: process.env.SLACK_BOT_TOKEN,
    channel: im.channel.id,
    text: message,
  });
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1)); // random index from 0 to i
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function postDelayed(client, channel, postArray, rePostArray = []) {
  if (!postArray.length) {
    return postNotVoted(client, channel, rePostArray);
  }
  const row = postArray.pop();
  rePostArray.push(row);
  client.chat.postMessage({
    token: process.env.SLACK_BOT_TOKEN,
    channel: channel,
    text: `Stemmen op *${row.name}*: *${row.votedBy.length + (row.votedByMayor ? 0.5 : 0)}* ${
      row.votedBy.length ? `(${row.votedBy.join(", ")})` : ""
    }`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Stemmen op *${row.name}*: *${row.votedBy.length + (row.votedByMayor ? 0.5 : 0)}* ${
            row.votedBy.length ? `(${row.votedBy.join(", ")})` : ""
          }`,
        },
      },
    ],
  });
  setTimeout(
    () => postDelayed(client, channel, postArray, rePostArray),
    2000 + Math.random() * 4000,
  );
}

function postNotVoted(client, channel, postArray) {
  const notVoteList = [];
  const notVoteMessage = `Je hebt niet gestemd, stemmen is verplicht, als je twee keer niet stemt zonder afstemming zal de verteller je uit het spel halen; vergeet alsjeblieft volgende keer niet te stemmen!`;
  for (const player of postArray) {
    if (!player.hasVoted) {
      notVoteList.push(`<@${player.id}> (${player.missedVotes}x)`);
      sendIM(client, player.id, notVoteMessage);
    }
  }
  if (notVoteList.length) {
    client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channel,
      text: `Spelers die niet hebben gestemd: ${notVoteList.join(", ")}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Spelers die niet hebben gestemd: ${notVoteList.join(", ")}`,
          },
        },
      ],
    });
  }
}
