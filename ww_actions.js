module.exports = {
  addActions,
  selfInviteClickFunction,
  joinActionFunction,
  viewActionFunction,
  unregisterActionFunction,
  addModeratorFunction,
  createNewChannelFunction,
};

let helpers = require("./ww_helpers");
const queries = require("./ww_queries");
const { t } = require("localizify");

let client;

function addActions(app, webClient) {
  client = webClient;
  app.action(/^stem-.*/, voteClick);
  app.action(/^vluchtig-.*/, quickVoteClick);
  app.action(/^selfinvite-.*/, selfInviteClick);
  app.action(/^inschrijven-.*/, joinAction);
  app.action(/^meekijken-.*/, viewAction);
  app.action(/^uitschrijven-.*/, unregisterAction);
  app.action(/^delete-.*/, deleteMessage);
  app.action(/^verteller-.*/, addModeratorAction);
  app.action(/^kanaal-.*/, createNewChannel);
}

const vluchtigeStemmingen = [];

async function voteClick({ body, ack, say }) {
  ack();
  try {
    const game = await queries.getActiveGameWithChannel(body.channel.id);
    const channelUsersList = await helpers.getUserlist(client, body.channel.id);
    await queries.votesOn(game.gms_id, body.user.id, body.actions[0].value);

    await client.chat.postEphemeral({
      token: process.env.SLACK_BOT_TOKEN,
      channel: body.channel.id,
      text: `Je hebt gestemd op: ${channelUsersList
        .filter((x) => x.id === body.actions[0].value)
        .map((x) => x.name)
        .join()}`,
      user: body.user.id,
    });
    const channelId = await queries.getChannel(
      game.gms_id,
      helpers.channelType.stemstand,
    );
    await client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      text: `<@${body.user.id}> heeft gestemd op: <@${body.actions[0].value}>`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `<@${body.user.id}> heeft gestemd op: <@${body.actions[0].value}>`,
          },
        },
      ],
    });
  } catch (error) {
    await helpers.sendIM(
      client,
      body.user.id,
      `Er ging iets mis met het stemmen: ${error}`,
    );
  }
}

function removePreviousVluchtigeVote(votesByMessage, messageTs, userId) {
  const votes = votesByMessage[messageTs];
  for (const voteTarget in votes) {
    if (votes[voteTarget].length && votes[voteTarget].includes(userId)) {
      votes[voteTarget].splice(votes[voteTarget].indexOf(userId), 1);
    }
  }
}

function addVluchtigeVote(votesByMessage, messageTs, voteTarget, userId) {
  if (votesByMessage[messageTs][voteTarget]) {
    votesByMessage[messageTs][voteTarget].push(userId);
  } else {
    votesByMessage[messageTs][voteTarget] = [userId];
  }
}

function buildVluchtigeButtonBlocks(playersByChunk, votedOn) {
  const buttonblocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "vluchtige stemming:",
      },
    },
  ];

  if (!votedOn || votedOn === "sluit") {
    buttonblocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "stemming gesloten",
      },
    });
    return buttonblocks;
  }

  for (const channelChunk of playersByChunk) {
    buttonblocks.push({
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
    });
  }

  buttonblocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: `sluit vluchtige stemming`,
        },
        value: "sluit",
        action_id: `vluchtig-sluit`,
      },
    ],
  });

  return buttonblocks;
}

function buildVluchtigeStemUitslag(votes) {
  const stemUitslag = [];
  for (const voteTarget in votes) {
    stemUitslag.push(
      `<@${voteTarget}>: *${votes[voteTarget].length}* (${votes[voteTarget]
        .map((x) => `<@${x}>`)
        .join(", ")})`,
    );
  }
  return stemUitslag;
}

async function quickVoteClick({ body, ack, say }) {
  ack();
  try {
    if (!vluchtigeStemmingen[body.message.ts]) {
      vluchtigeStemmingen[body.message.ts] = [];
    }
    const user = body.user.id;
    const votedOn = body.actions[0].value;
    const game = await queries.getActiveGameWithChannel(body.channel.id);
    if (votedOn !== "sluit") {
      removePreviousVluchtigeVote(vluchtigeStemmingen, body.message.ts, user);
      addVluchtigeVote(vluchtigeStemmingen, body.message.ts, votedOn, user);
    }
    let playersAlive = await queries.getAlive(game.gms_id);
    playersAlive = await helpers.addSlackName(client, playersAlive);
    const chuckedUsersAlive = [];
    while (playersAlive.length) {
      chuckedUsersAlive.push(playersAlive.splice(0, 5));
    }

    const buttonblocks = buildVluchtigeButtonBlocks(chuckedUsersAlive, votedOn);
    const stemUitslag = buildVluchtigeStemUitslag(
      vluchtigeStemmingen[body.message.ts],
    );
    buttonblocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `stemmen:\n${stemUitslag.join("\n")}`,
      },
    });
    await client.chat.update({
      token: process.env.SLACK_BOT_TOKEN,
      channel: body.container.channel_id,
      ts: body.container.message_ts,
      text: `vluchtige stemming: ${stemUitslag.join("; ") || "gesloten"}`,
      blocks: buttonblocks,
    });
    if (!votedOn || votedOn === "sluit") {
      vluchtigeStemmingen[body.message.ts] = [];
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      body.user.id,
      `Er ging iets mis met het vluchtig stemmen: ${error}`,
    );
  }
}

async function selfInviteClick({ body, ack, say }) {
  ack();
  const inviteTarget = body.actions[0].value;
  const userId = body.user.id;
  if (inviteTarget.startsWith("allchannels-")) {
    const gameId = Number.parseInt(inviteTarget.split("-")[1], 10);
    if (!Number.isNaN(gameId)) {
      await selfInviteAllChannelsFunction(gameId, userId);
      return;
    }
  }
  await selfInviteClickFunction(inviteTarget, userId);
}

async function selfInviteClickFunction(channelId, userId) {
  try {
    await client.conversations.invite({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      users: userId,
    });
  } catch (error) {
    await helpers.sendIM(
      client,
      userId,
      `Er ging iets mis met het het zelf uitnodigen: ${error}`,
    );
  }
}

async function selfInviteAllChannelsFunction(gameId, userId) {
  try {
    const channels = await queries.getAllChannels(gameId);
    for (const channel of channels) {
      try {
        await client.conversations.invite({
          token: process.env.SLACK_BOT_TOKEN,
          channel: channel.gch_slack_id,
          users: userId,
        });
      } catch (error) {
        if (error?.data?.error === "already_in_channel") {
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      userId,
      `Er ging iets mis met uitnodigen voor alle kanalen: ${error}`,
    );
  }
}

async function joinAction({ body, ack, say }) {
  ack();
  try {
    const userId = body.user.id;
    const gameId = body.actions[0].value;
    const msgChannelId = body.container.channel_id;
    const msgTs = body.container.message_ts;
    const singleGame = false;
    await joinActionFunction(userId, gameId, msgChannelId, msgTs, singleGame);
  } catch (error) {
    await helpers.sendIM(
      client,
      body.user.id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDIWILLJOIN")}: ${error}`,
    );
  }
}

async function joinActionFunction(
  userId,
  gameId,
  msgChannelId,
  msgTs,
  singleGame,
) {
  try {
    const userName = await helpers.getUserName(client, userId);
    const result = await queries.joinGame(gameId, userId, userName);
    const thisGame = await queries.getSpecificGame(gameId);
    if (result.succes) {
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: process.env.REG_CHANNEL,
        text: `${userName} ${t("TEXTJOINED")} ${t(thisGame.gms_name)}, ${t("TEXTTHEREARE")} ${
          result.numberOfPlayers
        } ${t("TEXTAMOUNTJOINED")} ${t("TEXTAMOUNTVIEWING")} ${result.numberOfViewers}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${userName} ${t("TEXTJOINED")} ${t(thisGame.gms_name)}, ${t("TEXTTHEREARE")} ${
                result.numberOfPlayers
              } ${t("TEXTAMOUNTJOINED")} ${t("TEXTAMOUNTVIEWING")} ${result.numberOfViewers}`,
            },
          },
        ],
      });
      const doeMeeMessage = t("TEXTJOINEDGAME");
      await helpers.sendIM(client, userId, doeMeeMessage);
    } else {
      await helpers.sendIM(
        client,
        userId,
        `${t("TEXTCOMMANDERROR")} ${t("COMMANDIWILLJOIN")}: ${result.error}`,
      );
    }
    if (!singleGame) {
      const games = await queries.getGameRegisterUser(userId);
      if (games.length > 0) {
        let buttonElements = [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: `${t("TEXTCLOSEMESSAGE")}`,
            },
            value: "Close",
            action_id: `delete-${msgChannelId}`,
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
        await client.chat.update({
          token: process.env.SLACK_BOT_TOKEN,
          channel: msgChannelId,
          ts: msgTs,
          text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKREGISTER")}`,
          blocks: buttonblocks,
        });
      } else {
        await client.chat.delete({
          token: process.env.SLACK_BOT_TOKEN,
          channel: msgChannelId,
          ts: msgTs,
        });
      }
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      userId,
      `Er ging iets mis met deelnemen: ${error}`,
    );
  }
}

async function viewAction({ body, ack, say }) {
  ack();
  try {
    const userId = body.user.id;
    const gameId = body.actions[0].value;
    const msgChannelId = body.container.channel_id;
    const msgTs = body.container.message_ts;
    const singleGame = false;
    await viewActionFunction(userId, gameId, msgChannelId, msgTs, singleGame);
  } catch (error) {
    await helpers.sendIM(
      client,
      body.user.id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDIWILLVIEW")}: ${error}`,
    );
  }
}

async function viewActionFunction( // NOSONAR
  userId,
  gameId,
  msgChannelId,
  msgTs,
  singleGame,
) {
  try {
    const userName = await helpers.getUserName(client, userId);
    const game = await queries.getSpecificGame(gameId);
    const result = await queries.viewGame(userId, userName, game.gms_id);
    if (result.succes) {
      if (game.gms_status === "REGISTERING") {
        await client.chat.postMessage({
          token: process.env.SLACK_BOT_TOKEN,
          channel: process.env.REG_CHANNEL,
          text: `${userName} ${t("TEXTVIEWED")} ${t(game.gms_name)}, ${t("TEXTTHEREARE")} ${
            result.numberOfPlayers
          } ${t("TEXTAMOUNTJOINED")} ${t("TEXTAMOUNTVIEWING")} ${result.numberOfViewers}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${userName} ${t("TEXTVIEWED")} ${t(game.gms_name)}, ${t("TEXTTHEREARE")} ${
                  result.numberOfPlayers
                } ${t("TEXTAMOUNTJOINED")} ${t("TEXTAMOUNTVIEWING")} ${result.numberOfViewers}`,
              },
            },
          ],
        });
      } else if (game.gms_status === "STARTED") {
        await client.chat.postMessage({
          token: process.env.SLACK_BOT_TOKEN,
          channel: process.env.REG_CHANNEL,
          text: `${t("TEXTVIEWERJOINED")} ${userName}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${t("TEXTVIEWERJOINED")} ${userName}`,
              },
            },
          ],
        });

        //invite player to main channel
        const mainId = await queries.getChannel(
          game.gms_id,
          helpers.channelType.main,
        );
        await client.conversations.invite({
          token: process.env.SLACK_BOT_TOKEN,
          channel: mainId,
          users: userId,
        });
        //invite player to stemhok
        const voteId = await queries.getChannel(
          game.gms_id,
          helpers.channelType.vote,
        );
        await client.conversations.invite({
          token: process.env.SLACK_BOT_TOKEN,
          channel: voteId,
          users: userId,
        });
        //invite player to sectators
        const sectatorId = await queries.getChannel(
          game.gms_id,
          helpers.channelType.sectator,
        );
        await client.conversations.invite({
          token: process.env.SLACK_BOT_TOKEN,
          channel: sectatorId,
          users: userId,
        });
        //invite player to kletskanaal
        const talkChannelId = await queries.getChannel(
          game.gms_id,
          helpers.channelType.talking,
        );
        await client.conversations.invite({
          token: process.env.SLACK_BOT_TOKEN,
          channel: talkChannelId,
          users: userId,
        });
        //send IM to vertellers
        const moderatorMessage = `${t("TEXTVIEWERJOINED")} ${userName}`;
        const moderators = await queries.getModerators(game.gms_id);
        for (const moderator of moderators) {
          await helpers.sendIM(client, moderator, moderatorMessage);
        }
      }
      const viewMessage = `${t("TEXTVIEWEDGAME")} ${t("COMMANDREMOVEYOURSELFFROMGAME")}`;
      await helpers.sendIM(client, userId, viewMessage);

      if (!singleGame) {
        const games = await queries.getGameOpenUser(userId);

        if (games.length > 0) {
          let buttonElements = [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: `${t("TEXTCLOSEMESSAGE")}`,
              },
              value: "Close",
              action_id: `delete-${msgChannelId}`,
            },
          ];
          for (const singleGame of games) {
            buttonElements.push({
              type: "button",
              text: {
                type: "plain_text",
                text: singleGame.gms_name,
              },
              value: singleGame.gms_id.toString(),
              action_id: `meekijken-${singleGame.gms_id}`,
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
          await client.chat.update({
            token: process.env.SLACK_BOT_TOKEN,
            channel: msgChannelId,
            ts: msgTs,
            text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKVIEW")}`,
            blocks: buttonblocks,
          });
        } else {
          await client.chat.delete({
            token: process.env.SLACK_BOT_TOKEN,
            channel: msgChannelId,
            ts: msgTs,
          });
        }
      }
    } else {
      await helpers.sendIM(
        client,
        userId,
        `${t("TEXTCOMMANDERROR")} ${t("COMMANDIWILLVIEW")}: ${result.error}`,
      );
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      userId,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDIWILLVIEW")}: ${error}`,
    );
  }
}

async function unregisterAction({ body, ack, say }) {
  ack();
  try {
    const userId = body.user.id;
    const gameId = body.actions[0].value;
    const msgChannelId = body.container.channel_id;
    const msgTs = body.container.message_ts;
    const singleGame = false;
    await unregisterActionFunction(
      userId,
      gameId,
      msgChannelId,
      msgTs,
      singleGame,
    );
  } catch (error) {
    await helpers.sendIM(
      client,
      body.user.id,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDREMOVEYOURSELFFROMGAME")}: ${error}`,
    );
  }
}

async function unregisterActionFunction(
  userId,
  gameId,
  msgChannelId,
  msgTs,
  singleGame,
) {
  try {
    const userName = await helpers.getUserName(client, userId);
    const result = await queries.leaveGame(gameId, userId);
    const thisGame = await queries.getSpecificGame(gameId);
    if (result.succes) {
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN,
        channel: process.env.REG_CHANNEL,
        text: `${userName} ${t("TEXTNOTINGAMEANYMORE")} ${thisGame.gms_name}, ${t("TEXTTHEREARE")} ${
          result.numberOfPlayers
        } ${t("TEXTAMOUNTJOINED")} ${t("TEXTAMOUNTVIEWING")} ${result.numberOfViewers}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${userName} ${t("TEXTNOTINGAMEANYMORE")} ${thisGame.gms_name}, ${t("TEXTTHEREARE")} ${
                result.numberOfPlayers
              } ${t("TEXTAMOUNTJOINED")} ${t("TEXTAMOUNTVIEWING")} ${result.numberOfViewers}`,
            },
          },
        ],
      });
      const doeMeeMessage = `${t("TEXTPLAYERNOTINGAME")} ${thisGame.gms_name}. ${t("TEXTCHANGEDMIND")} ${t(
        "COMMANDIWILLJOIN",
      )}`;
      await helpers.sendIM(client, userId, doeMeeMessage);
      if (!singleGame) {
        const games = await queries.getGameUnregisterUser(userId);
        if (games.length > 0) {
          let buttonElements = [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: `${t("TEXTCLOSEMESSAGE")}`,
              },
              value: "Close",
              action_id: `delete-${msgChannelId}`,
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
                text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKUNREGISTER")}`,
              },
            },
            {
              type: "actions",
              elements: buttonElements,
            },
          ];
          await client.chat.update({
            token: process.env.SLACK_BOT_TOKEN,
            channel: msgChannelId,
            ts: msgTs,
            text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKUNREGISTER")}`,
            blocks: buttonblocks,
          });
        } else {
          await client.chat.delete({
            token: process.env.SLACK_BOT_TOKEN,
            channel: msgChannelId,
            ts: msgTs,
          });
        }
      }
    } else {
      await helpers.sendIM(
        client,
        userId,
        `${t("TEXTCOMMANDERROR")} ${t("COMMANDREMOVEYOURSELFFROMGAME")}: ${result.error}`,
      );
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      userId,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDREMOVEYOURSELFFROMGAME")}: ${error}`,
    );
  }
}

async function addModeratorAction({ body, ack, say }) {
  await ack();
  const userId = body?.user?.id;
  try {
    const moderatorId = body.actions[0].value;
    const channelId = process.env.REG_CHANNEL;
    const gameId = body.actions[0].action_id.trim().split("-")[1];
    const msgChannelId = body.container.channel_id;
    const msgTs = body.container.message_ts;
    const singleGame = false;
    await addModeratorFunction(
      moderatorId,
      userId,
      channelId,
      gameId,
      msgChannelId,
      msgTs,
      singleGame,
    );
  } catch (error) {
    await helpers.sendIM(
      client,
      userId,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDEXTRAMODERATOR")}: ${error}`,
    );
  }
}

function isIgnorableInviteError(error) {
  const errorCode = error?.data?.error || error?.error;
  return errorCode === "already_in_channel";
}

async function inviteUserToChannel(channelId, userId) {
  try {
    await client.conversations.invite({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      users: userId,
    });
  } catch (error) {
    if (isIgnorableInviteError(error)) {
      return;
    }
    throw error;
  }
}

async function inviteModeratorToGameChannels(
  gameId,
  moderatorId,
  mainChannelId,
) {
  const allChannels = await queries.getAllChannels(gameId);
  let resolvedMainChannel = mainChannelId;

  for (const oneChannel of allChannels) {
    await inviteUserToChannel(oneChannel.gch_slack_id, moderatorId);
    if (oneChannel.gch_type === "MAIN") {
      resolvedMainChannel = oneChannel.gch_slack_id;
    }
  }

  return resolvedMainChannel;
}

async function updateModeratorSelectionMessage(
  userId,
  moderatorId,
  msgChannelId,
  msgTs,
) {
  const games = await queries.getGameModerator(userId, moderatorId);
  if (!games.length) {
    await client.chat.delete({
      token: process.env.SLACK_BOT_TOKEN,
      channel: msgChannelId,
      ts: msgTs,
    });
    return;
  }

  const buttonElements = [
    {
      type: "button",
      text: {
        type: "plain_text",
        text: `${t("TEXTCLOSEMESSAGE")}`,
      },
      value: "Close",
      action_id: `delete-${msgChannelId}`,
    },
    ...games.map((game) => ({
      type: "button",
      text: {
        type: "plain_text",
        text: game.gms_name,
      },
      value: moderatorId,
      action_id: `verteller-${game.gms_id}`,
    })),
  ];

  const buttonblocks = [
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

  await client.chat.update({
    token: process.env.SLACK_BOT_TOKEN,
    channel: msgChannelId,
    ts: msgTs,
    text: `${t("TEXTCLICKGAME")} ${t("TEXTCLICKVERTELLER")}`,
    blocks: buttonblocks,
  });
}

async function addModeratorFunction(
  moderatorId,
  userId,
  mainChannel,
  gameId,
  msgChannelId,
  msgTs,
  singleGame,
) {
  try {
    const thisGame = await queries.getSpecificGame(gameId);
    const userName = await helpers.getUserName(client, moderatorId);
    await queries.addModerator(moderatorId, userName, thisGame.gms_id);

    if (thisGame.gms_status === "STARTED") {
      mainChannel = await inviteModeratorToGameChannels(
        thisGame.gms_id,
        moderatorId,
        mainChannel,
      );
    }

    await client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: mainChannel,
      text: `${userName} ${t("TEXTISVERTELLER")} ${thisGame.gms_name}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${userName} ${t("TEXTISVERTELLER")} ${thisGame.gms_name}`,
          },
        },
      ],
    });
    const message = `${t("TEXTBECAMEMODERATOR")} ${thisGame.gms_name}`;
    await helpers.sendIM(client, moderatorId, message);

    if (!singleGame) {
      await updateModeratorSelectionMessage(
        userId,
        moderatorId,
        msgChannelId,
        msgTs,
      );
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      userId,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDEXTRAMODERATOR")}: ${error}`,
    );
  }
}

async function createNewChannel({ body, ack, say }) {
  ack();
  try {
    const userId = body.user.id;
    const gameId = body.actions[0].action_id.trim().split("-")[1];
    const channelName = body.actions[0].value;
    const msgChannelId = body.container.channel_id;
    const msgTs = body.container.message_ts;
    const singleGame = false;
    await createNewChannelFunction(
      gameId,
      userId,
      channelName,
      msgChannelId,
      msgTs,
      singleGame,
    );
  } catch (error) {
    await helpers.sendIM(
      client,
      userId,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDCREATECHANNEL")}: ${error}`,
    );
  }
}

async function createNewChannelFunction(
  gameId,
  userId,
  newChannelName,
  msgChannelId,
  msgTs,
  singleGame,
) {
  try {
    if (newChannelName.trim().length === 0) {
      throw new Error(t("TEXTNONAME"));
    }
    const allModerators = await queries.getModerators(gameId);
    const game = await queries.getSpecificGame(gameId);
    if (!allModerators.includes(userId)) {
      allModerators.push(userId);
    }
    let channelName;
    const regexName = /^ww\d.*/i;
    if (regexName.test(newChannelName) === false) {
      channelName = `${game.gms_name.toLowerCase().split(" ").join("_")}_${newChannelName.toLowerCase()}`;
    } else {
      channelName = newChannelName.toLowerCase();
    }

    const channel = await client.conversations.create({
      token: process.env.SLACK_BOT_TOKEN,
      name: channelName,
      is_private: true,
    });
    await client.conversations.invite({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channel.channel.id,
      users: allModerators.join(","),
    });
    await client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channel.channel.id,
      text: `${await helpers.getUserName(client, userId)} ${t("TEXTCREATEDCHANNEL")}`,
    });
    const channelInput = {
      gch_gms_id: gameId,
      gch_slack_id: channel.channel.id,
      gch_name: channel.channel.name,
      gch_type: helpers.channelType.standard,
      gch_user_created: userId,
    };
    await queries.logChannel(channelInput);
    if (!singleGame) {
      await client.chat.delete({
        token: process.env.SLACK_BOT_TOKEN,
        channel: msgChannelId,
        ts: msgTs,
      });
    }
  } catch (error) {
    await helpers.sendIM(
      client,
      userId,
      `${t("TEXTCOMMANDERROR")} ${t("COMMANDCREATECHANNEL")}: ${error}`,
    );
  }
}

async function deleteMessage({ body, ack, say }) {
  ack();
  try {
    await client.chat.delete({
      token: process.env.SLACK_BOT_TOKEN,
      channel: body.container.channel_id,
      ts: body.container.message_ts,
    });
  } catch (error) {
    await helpers.sendIM(
      client,
      body.user.id,
      `${t("TEXTCOMMANDERROR")}: ${error}`,
    );
  }
}
