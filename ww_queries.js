const { Pool } = require("pg");
const { t } = require("localizify");

const dbHost = process.env.DB_HOST || "localhost";
const dbPort = process.env.DB_PORT || "5432";
const dbName = process.env.DB_DATABASE || "postgres";
const dbSchema = process.env.DB_SCHEMA || "public";
const dbConnectionUrl = new URL(
  `postgresql://${dbHost}:${dbPort}/${dbName}?schema=${dbSchema}`,
);

if (process.env.DB_USER) {
  dbConnectionUrl.username = process.env.DB_USER;
}
if (process.env.DB_PASS) {
  dbConnectionUrl.password = process.env.DB_PASS;
}

module.exports = {
  getLastGameName,
  createNewGame,
  startGame,
  stopGame,
  joinGame,
  viewGame,
  leaveGame,
  getGame,
  getGameRegisterUser,
  getGameUnregisterUser,
  getGameOpenUser,
  getGameModerator,
  getGameState,
  getSpecificGame,
  getGameName,
  getActiveGameName,
  isModerator,
  isSectator,
  getModerators,
  addModerator,
  startPoll,
  stopPoll,
  getPollName,
  getPollResults,
  getCurrentPollResults,
  getGameHasPlayer,
  setMessageIdPoll,
  killUser,
  reanimateUser,
  getEveryOne,
  getAlive,
  getAliveNotVoted,
  getActiveGameWithChannel,
  getGameWithChannel,
  getActiveGameUser,
  getNotDrawnPlayers,
  getPlayerList,
  votesOn,
  logChannel,
  getChannel,
  logArchiveChannel,
  getAllChannels,
  messageCountPlusPlus,
  storeMessage,
  threadIdsInChannelByDate,
  nonThreadedMessagesInChannelByDate,
  threadedMessagesInChannelByTS,
  getEnrollment,
};

const pool = new Pool({
  connectionString: dbConnectionUrl.toString(),
});

const promisePool = {
  query: async (query, params = []) => {
    const result = await pool.query(query, params);
    return result;
  },
};

const gameStates = {
  registering: "REGISTERING",
  ended: "ENDED",
  started: "STARTED",
};

const playerStates = {
  alive: "ALIVE",
  dead: "DEAD",
  verteller: "VERTELLER",
  viewer: "VIEWER",
};

const pollStates = {
  open: "OPEN",
  closed: "CLOSED",
};

async function getLastGameName() {
  try {
    const { rows } = await promisePool.query(
      `select gms_name from games where gms_id = (select max(gms_id) from games)`,
    );
    return rows;
  } catch (err) {
    console.log(err);
  }
}

async function createNewGame(voteStyle, gameName, revivable, userId, userName) {
  try {
    await promisePool.query(
      `insert into games (gms_name, gms_status, gms_vote_style, gms_revive, gms_created_at)
      values ($1,$2,$3,$4, current_timestamp)`,
      [gameName, gameStates.registering, voteStyle, revivable],
    );

    const game = await getNewGame();
    await addModerator(userId, userName, game.gms_id);
    return { succes: true, gameName: game.gms_name };
  } catch (err) {
    console.log(err);
    return { succes: false, error: err };
  }
}

async function startGame(gameId, maxPlayers) {
  try {
    await promisePool.query(
      `update game_players
      set gpl_drawn = true
      where (gpl_gms_id, gpl_slack_id) in (
          select gpl_gms_id,  gpl_slack_id from (
          select reg_game.gpl_gms_id, gpl.gpl_slack_id, sum(case when gpl.gpl_not_drawn then 1 else 0 end ) 
            from game_players gpl
             join games on gms_id = gpl_gms_id
            join (select gpl_slack_id, gpl_gms_id
                  from game_players gpl
                  where gpl_gms_id = $1
                  and not gpl.gpl_leader
                  and gpl.gpl_status <> $2
                  and not exists (select 'already alive'
                      from game_players gp3
                      join games g2 on gp3.gpl_gms_id = g2.gms_id
                      where gp3.gpl_slack_id = gpl.gpl_slack_id
                      and g2.gms_status = $3
                      and gp3.gpl_status = $4
                      and gp3.gpl_gms_id <> gpl.gpl_gms_id)
                  and not exists (select 'revivable' 
                          from game_players gp4
                          join games g3 on g3.gms_id = gp4.gpl_gms_id
                          where gp4.gpl_slack_id = gpl.gpl_slack_id
                          and g3.gms_revive  
                          and g3.gms_status = $5
                          and gp4.gpl_status = $6)
                ) reg_game
            on reg_game.gpl_slack_id = gpl.gpl_slack_id
            group by 1, 2
            order by 3 desc, RANDOM()
            limit $7) prefDraw)`,
      [
        gameId,
        playerStates.viewer,
        gameStates.started,
        playerStates.alive,
        gameStates.started,
        playerStates.dead,
        maxPlayers * 1,
      ],
    );
    await promisePool.query(
      `update games
       set gms_status = $1 
       where gms_id = $2`,
      [gameStates.started, gameId],
    );
    const { rows } = await promisePool.query(
      `select gpl_slack_id
       from game_players gpl
       where gpl_gms_id = $1
       and gpl_drawn`,
      [gameId],
    );
    const { rows: rows2 } = await promisePool.query(
      `select gpl_slack_id from game_players gpl 
      where gpl_gms_id = $1 
      and (gpl_status = $2 or gpl_leader)`,
      [gameId, playerStates.viewer],
    );
    const { rows: rows3 } = await promisePool.query(
      `select gpl_slack_id from game_players gpl 
      where gpl_gms_id = $1 
      and gpl_leader`,
      [gameId],
    );
    await promisePool.query(
      `delete from game_players gpl
      using games g,
        (select gpl_slack_id, gpl_gms_id
          from game_players gpl
          where gpl_gms_id = $1
          and gpl.gpl_drawn
          and not gpl.gpl_leader
          ) reg_game
      where g.gms_id = gpl.gpl_gms_id
      and reg_game.gpl_slack_id = gpl.gpl_slack_id
      and g.gms_id <> reg_game.gpl_gms_id
      and g.gms_status = $2
      and gpl.gpl_status = $3`,
      [gameId, gameStates.registering, playerStates.alive],
    );
    return {
      succes: true,
      playerList: rows,
      viewerList: rows2,
      vertellerList: rows3,
    };
  } catch (err) {
    console.log(err);
    return { succes: false, error: err };
  }
}

async function stopGame(gameId) {
  try {
    await promisePool.query(
      `update games
       set gms_status = $1 
       where gms_id = $2`,
      [gameStates.ended, gameId],
    );
    return { succes: true };
  } catch (err) {
    console.log(err);
    return { succes: false, error: err };
  }
}

async function joinGame(gameId, userId, userName) {
  try {
    const gameHasPlayer = await getGameHasPlayer(gameId, userId);
    const gameHasViewer = await getGameHasViewer(gameId, userId);
    if (gameHasPlayer) {
      return { succes: false, error: `${t("TEXTALREADYENROLLED")}` };
    }
    if (gameHasViewer) {
      await promisePool.query(
        `update game_players 
            set gpl_status = $1
            where gpl_gms_id =$2 
            and gpl_slack_id = $3`,
        [playerStates.alive, gameId, userId],
      );

      const { rows } = await promisePool.query(
        `select
        coalesce(sum(case when gpl_status in ('DEAD', 'ALIVE') then 1 else 0 end), 0) as "numberOfPlayers",
        coalesce(sum(case when gpl_status in ('VIEWER') then 1 else 0 end), 0) as "numberOfViewers"
        from game_players
        where gpl_gms_id = $1`,
        [gameId],
      );
      return {
        succes: true,
        numberOfPlayers: rows[0].numberOfPlayers,
        numberOfViewers: rows[0].numberOfViewers,
      };
    }
    await promisePool.query(
      `insert into game_players
          (gpl_gms_id, gpl_slack_id, gpl_name, gpl_status, gpl_leader, gpl_drawn, gpl_not_drawn, gpl_number_of_messages)
        values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [gameId, userId, userName, playerStates.alive, false, false, false, 0],
    );

    const { rows } = await promisePool.query(
      `select
        coalesce(sum(case when gpl_status in ('DEAD', 'ALIVE') then 1 else 0 end), 0) as "numberOfPlayers",
        coalesce(sum(case when gpl_status in ('VIEWER') then 1 else 0 end), 0) as "numberOfViewers"
        from game_players
        where gpl_gms_id = $1`,
      [gameId],
    );
    return {
      succes: true,
      numberOfPlayers: rows[0].numberOfPlayers,
      numberOfViewers: rows[0].numberOfViewers,
    };
  } catch (err) {
    console.log(err);
    return { succes: false, error: err };
  }
}

async function viewGame(userId, userName, gameId) {
  try {
    const gameHasViewer = await getGameHasViewer(gameId, userId);
    const gameHasPlayer = await getGameHasPlayer(gameId, userId);
    const moderator = await isModerator(gameId, userId);
    if (moderator) {
      return { succes: false, error: "je bent de verteller" };
    }
    if (gameHasViewer) {
      return { succes: false, error: "je bent al ingeschreven als kijker" };
    }
    if (gameHasPlayer) {
      await promisePool.query(
        `update game_players 
            set gpl_status = $1
            where gpl_gms_id =$2 
            and gpl_slack_id = $3`,
        [playerStates.viewer, gameId, userId],
      );
      const { rows } = await promisePool.query(
        `select 
          coalesce(sum(case when gpl_status in ('DEAD', 'ALIVE') then 1 else 0 end), 0) as "numberOfPlayers",
          coalesce(sum(case when gpl_status in ('VIEWER') then 1 else 0 end), 0) as "numberOfViewers"
          from game_players
          where gpl_gms_id = $1`,
        [gameId],
      );
      return {
        succes: true,
        numberOfPlayers: rows[0].numberOfPlayers,
        numberOfViewers: rows[0].numberOfViewers,
      };
    }
    await promisePool.query(
      `insert into game_players
        (gpl_gms_id, gpl_slack_id, gpl_name, gpl_status, gpl_leader, gpl_drawn, gpl_not_drawn, gpl_number_of_messages)
        values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [gameId, userId, userName, playerStates.viewer, false, false, false, 0],
    );
    const { rows } = await promisePool.query(
      `select 
        coalesce(sum(case when gpl_status in ('DEAD', 'ALIVE') then 1 else 0 end), 0) as "numberOfPlayers",
        coalesce(sum(case when gpl_status in ('VIEWER') then 1 else 0 end), 0) as "numberOfViewers"
        from game_players
        where gpl_gms_id = $1`,
      [gameId],
    );
    return {
      succes: true,
      numberOfPlayers: rows[0].numberOfPlayers,
      numberOfViewers: rows[0].numberOfViewers,
    };
  } catch (err) {
    console.log(err);
    return { succes: false, error: err };
  }
}

async function leaveGame(gameId, userId) {
  try {
    await promisePool.query(
      `delete from game_players
       where gpl_gms_id = $1
       and gpl_slack_id = $2`,
      [gameId, userId],
    );
    const { rows } = await promisePool.query(
      `select 
        coalesce(sum(case when gpl_status in ('DEAD', 'ALIVE') then 1 else 0 end), 0) as "numberOfPlayers",
        coalesce(sum(case when gpl_status in ('VIEWER') then 1 else 0 end), 0) as "numberOfViewers"
        from game_players
        where gpl_gms_id = $1`,
      [gameId],
    );
    return {
      succes: true,
      numberOfPlayers: rows[0].numberOfPlayers,
      numberOfViewers: rows[0].numberOfViewers,
    };
  } catch (err) {
    console.log(err);
    return { succes: false, error: err };
  }
}

async function getGameState() {
  const { rows } = await promisePool.query(
    `select gms_name
          , gms_id
          , gms_status
          , sum(case when gpl_status in ('DEAD', 'ALIVE') then 1 else 0 end) players
          , sum(case when gpl_status in ('ALIVE') then 1 else 0 end) alive
          , sum(case when gpl_status in ('VIEWER') then 1 else 0 end) viewers
          , sum(case when gpl_status in ('DEAD') then 1 else 0 end) dead
      from games
      left join game_players 
      on gms_id = gpl_gms_id
      where gms_status <> 'ENDED'
      group by 1,2,3
      order by 2`,
  );
  return rows;
}

async function getEnrollment() {
  const { rows } = await promisePool.query(
    `select gms_name as game
          , coalesce(gpl_status, 'UNKNOWN') as status
          , coalesce(string_agg(gpl_slack_id, ', ' order by gpl_slack_id), '') as players
      from games
      left join game_players 
      on gms_id = gpl_gms_id
      where gms_status <> 'ENDED'
      group by gms_id, gms_name, gpl_status
      order by gms_name, status`,
  );
  return rows;
}

async function isModerator(gameId, userId) {
  const { rows } = await promisePool.query(
    `select * 
      from game_players
      where gpl_gms_id = $1
      and gpl_slack_id = $2
      and gpl_leader`,
    [gameId, userId],
  );
  return rows.length;
}

async function isSectator(gameId, userId) {
  const { rows } = await promisePool.query(
    `select * 
      from game_players
      where gpl_gms_id = $1
      and gpl_slack_id = $2
      and gpl_status <> $3`,
    [gameId, userId, playerStates.alive],
  );
  return rows.length;
}

async function getModerators(gameId) {
  const { rows } = await promisePool.query(
    `select * 
      from game_players
      where gpl_gms_id = $1
      and gpl_leader`,
    [gameId],
  );
  return rows.map((x) => x.gpl_slack_id);
}

async function addModerator(userId, userName, gameId) {
  await promisePool.query(
    `insert into game_players
        (gpl_gms_id, gpl_slack_id, gpl_name, gpl_status, gpl_leader, gpl_drawn, gpl_not_drawn, gpl_number_of_messages)
      values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (gpl_gms_id, gpl_slack_id) do update
        set gpl_status = excluded.gpl_status
      , gpl_leader = excluded.gpl_leader`,
    [gameId, userId, userName, playerStates.verteller, true, false, false, 0],
  );
}

async function startPoll(gameId, voteName) {
  const poll = await getPoll(gameId);
  if (poll.gpo_status !== pollStates.closed) {
    throw new Error("Er is nog een actieve stemming");
  }
  await promisePool.query(
    `insert into game_polls
     (gpo_gms_id, gpo_number, gpo_title, gpo_status)
      values($1,$2,$3,$4)`,
    [gameId, +poll.gpo_number + 1, voteName, pollStates.open],
  );
}

async function getPollName(gameId) {
  const poll = await getPoll(gameId);
  const game = await getSpecificGame(gameId);
  return `Stemming ${+poll.gpo_number + 1} voor spel ${game.gms_name}`;
}

async function stopPoll(gameId) {
  const poll = await getPoll(gameId);
  if (poll.gpo_status !== pollStates.open) {
    throw new Error("Er is geen actieve stemming");
  }
  await promisePool.query(
    `update game_polls
      set gpo_status = $1
      where gpo_gms_id = $2
      and gpo_number = $3`,
    [pollStates.closed, gameId, poll.gpo_number],
  );
  return poll;
}

async function getPollResults(poll) {
  const { rows } = await promisePool.query(
    ` select gvo.* , 0 "missedVotes"
      from game_votes gvo
      where gvo_gpo_gms_id = $1 
      and gvo_gpo_number = $2 
      union 
      select null,null,null, gpl_slack_id ,null,null,null, 
      (select count(1) from game_polls where gpo_gms_id = $3) - sum(case when gvo_gpl_slack_id is null then 0 else 1 end)
      from game_players gpl
      left join game_votes gvo
      on gvo_gpo_gms_id = gpl_gms_id
      and gvo_gpl_slack_id  = gpl_slack_id 
      where gpl_gms_id = $4 
      and not exists(select 'voted'
      				from game_votes gvo
				    where gvo_gpo_gms_id = $5
				    and gvo_gpo_number = $6
				    and gvo_gpo_gms_id = gpl_gms_id
				    and gvo_gpl_slack_id  = gpl_slack_id)
      group by gpl_slack_id`,
    [
      poll.gpo_gms_id,
      poll.gpo_number,
      poll.gpo_gms_id,
      poll.gpo_gms_id,
      poll.gpo_gms_id,
      poll.gpo_number,
    ],
  );
  return rows;
}

async function getCurrentPollResults(gameId, mayorId = null) {
  const poll = await getPoll(gameId);
  if (poll.gpo_status !== pollStates.open) {
    throw new Error("Er is geen actieve stemming");
  }
  const { rows } = await promisePool.query(
    `select  gvo_voted_on_gpl_slack_id votee
            , sum(case when gvo_gpl_slack_id = $3 then 1.5 else 1 end) votes
            , string_agg(gvo_gpl_slack_id, ', @') voters
      from game_votes
      where gvo_gpo_gms_id = $1
      and gvo_gpo_number = $2
      group by 1
      order by 2 desc`,
    [poll.gpo_gms_id, poll.gpo_number, mayorId],
  );
  return rows;
}

async function setMessageIdPoll(gameId, message) {
  const poll = await getPoll(gameId);
  if (poll.gpo_status !== pollStates.open) {
    throw new Error("Er gaat iets mis met het aanmaken van de stemming");
  }
  await promisePool.query(
    `update game_polls
     set gpo_slack_message_id = $1
     where gpo_gms_id = $2
     and gpo_number = $3
     `,
    [`${message.channel}-${message.ts}`, poll.gpo_gms_id, poll.gpo_number],
  );
}

async function killUser(gameId, userId) {
  await checkAlive(gameId, userId);
  const { rows } = await promisePool.query(
    `update game_players
    set gpl_status = $1
    where gpl_gms_id = $2
    and gpl_slack_id = $3`,
    [playerStates.dead, gameId, userId],
  );
  return rows;
}

async function reanimateUser(gameId, userId) {
  await checkDead(gameId, userId);
  const { rows } = await promisePool.query(
    `update game_players
    set gpl_status = $1
    where gpl_gms_id = $2
    and gpl_slack_id = $3`,
    [playerStates.alive, gameId, userId],
  );
  return rows;
}

async function getEveryOne(gameId) {
  const { rows } = await promisePool.query(
    `select gpl_slack_id user_id
         , gpl_name name
      from game_players
      where gpl_gms_id = $1`,
    [gameId],
  );
  return rows;
}

async function getAlive(gameId) {
  const { rows } = await promisePool.query(
    `select gpl_slack_id user_id
         , gpl_name name
      from game_players
      where gpl_gms_id = $1
      and gpl_status = $2 
      and gpl_drawn
      order by random()`,
    [gameId, playerStates.alive],
  );
  return rows;
}

async function getAliveNotVoted(gameId) {
  const poll = await getPoll(gameId);
  if (poll.gpo_status !== pollStates.open) {
    throw new Error("Er is geen actieve stemming");
  }

  const { rows } = await promisePool.query(
    `select gpl_slack_id user_id
         , gpl_name name
      from game_players
      where gpl_gms_id = $1
      and gpl_status = $2 
      and gpl_drawn
      and not exists (select 'already voted'
                     from game_votes
                     where gvo_gpo_gms_id = $3
                     and gvo_gpo_number = $4
                     and gvo_gpl_gms_id = gpl_gms_id
                     and gvo_gpl_slack_id = gpl_slack_id)`,
    [gameId, playerStates.alive, poll.gpo_gms_id, poll.gpo_number],
  );
  return rows;
}

async function checkAlive(gmsId, userId) {
  const { rows } = await promisePool.query(
    `select gpl_slack_id user_id
         , gpl_name name
      from game_players
      where gpl_gms_id = $1
      and gpl_slack_id = $2
      and gpl_status = $3 
      and gpl_drawn`,
    [gmsId, userId, playerStates.alive],
  );
  if (!rows.length) {
    throw new Error(`Speler <@${userId}> leeft niet in dit spelletje`);
  }
}

async function checkDead(gmsId, userId) {
  const { rows } = await promisePool.query(
    `select gpl_slack_id user_id
         , gpl_name name
      from game_players
      where gpl_gms_id = $1
      and gpl_slack_id = $2
      and gpl_status = $3 
      and gpl_drawn`,
    [gmsId, userId, playerStates.dead],
  );
  if (!rows.length) {
    throw new Error(`Speler <@${userId}> is niet dood in dit spelletje`);
  }
}

async function votesOn(gameId, userIdFrom, userIdTo) {
  const poll = await getPoll(gameId);
  const { rows: aliveRows } = await promisePool.query(
    `select gpl_slack_id
      from game_players
      where gpl_gms_id = $1
      and gpl_slack_id = $2
      and gpl_status = $3
      and gpl_drawn`,
    [gameId, userIdFrom, playerStates.alive],
  );
  if (!aliveRows.length) {
    throw new Error("Alleen levende spelers mogen stemmen");
  }

  await promisePool.query(
    `insert into game_votes
      (gvo_gpo_gms_id, gvo_gpo_number, gvo_gpl_gms_id, gvo_gpl_slack_id, gvo_voted_on_gpl_gms_id, gvo_voted_on_gpl_slack_id, gvo_voted_at)
        values($1,$2,$3,$4,$5,$6, current_timestamp)
      on conflict (gvo_gpo_gms_id, gvo_gpo_number, gvo_gpl_gms_id, gvo_gpl_slack_id) do update
       set gvo_voted_on_gpl_gms_id = excluded.gvo_voted_on_gpl_gms_id
     , gvo_voted_on_gpl_slack_id = excluded.gvo_voted_on_gpl_slack_id
     , gvo_voted_at = current_timestamp`,
    [gameId, poll.gpo_number, gameId, userIdFrom, gameId, userIdTo],
  );
}

async function messageCountPlusPlus(userId, gameId) {
  await promisePool.query(
    `update game_players gp 
      set gpl_number_of_messages = coalesce(gpl_number_of_messages,0) +1
      where gpl_slack_id = $1
      and gpl_gms_id = $2`,
    [userId, gameId],
  );
}

async function getGame(status) {
  const { rows } = await promisePool.query(
    `select * 
      from games
      where gms_status = $1`,
    [status],
  );
  if (rows.length == 0) {
    throw new Error(`${t("TEXTGAMENOTFOUND")}`);
  }
  return rows;
}

async function getSpecificGame(gameId) {
  const { rows } = await promisePool.query(
    `select * 
      from games
      where gms_id = $1`,
    [gameId],
  );
  if (rows.length == 0) {
    throw new Error(`${t("TEXTGAMENOTFOUND")}`);
  }
  return rows[0];
}

async function getGameRegisterUser(userId) {
  const { rows } = await promisePool.query(
    `select  *
      from games
      where gms_status = $1
      and not exists (select 'is verteller or player'
                    from game_players
                    where gpl_gms_id = gms_id
                    and gpl_slack_id = $2
                    and gpl_status <> $3)`,
    [gameStates.registering, userId, playerStates.viewer],
  );
  return rows;
}

async function getGameUnregisterUser(userId) {
  const { rows } = await promisePool.query(
    `select * 
      from games
      left join (select * from game_players where gpl_slack_id = $1) as gpl
      on gpl_gms_id = gms_id
      where gms_status = $2
      and gpl_gms_id is not null
      and not gpl_leader`,
    [userId, gameStates.registering],
  );
  return rows;
}

async function getGameOpenUser(userId) {
  const { rows } = await promisePool.query(
    `select *
      from games
      left join game_players gpl
        on gpl_gms_id = gms_id
        and gpl_slack_id = $1
        and (gpl_status in ($2, $3)
    	        or gpl_drawn)
      where gms_status <> $4
        and gpl_status is null`,
    [userId, playerStates.viewer, playerStates.verteller, gameStates.ended],
  );
  return rows;
}

async function getGameModerator(userId, moderatorId) {
  const { rows } = await promisePool.query(
    `select  *
    from games
    where gms_status <> $1
    and exists (select 'is verteller'
            from game_players
            where gpl_gms_id = gms_id
            and gpl_slack_id = $2
            and gpl_leader
            )			
    and not exists (select 'is verteller or player'
            from game_players
            where gpl_gms_id = gms_id
                and gpl_slack_id = $3
            and (gpl_leader or gpl_drawn and gpl_status = 'ALIVE'))`,
    [gameStates.ended, userId, moderatorId],
  );
  return rows;
}

async function getNewGame() {
  const { rows } = await promisePool.query(
    `select * 
      from games
      order by gms_created_at desc`,
  );
  return rows[0];
}

async function getActiveGameWithChannel(channelId) {
  const { rows } = await promisePool.query(
    `select * from games
    join game_channels on gch_gms_id = gms_id
    where gch_slack_id = $1`,
    [channelId],
  );
  if (!rows[0]) {
    throw new Error("Dit kanaal is geen onderdeel van een spel");
  }
  if (rows[0].gms_status === gameStates.ended) {
    throw new Error("Dit spel is gestopt");
  }
  return rows[0];
}

async function getGameWithChannel(channelId) {
  const { rows } = await promisePool.query(
    `select * from games
    join game_channels on gch_gms_id = gms_id
    where gch_slack_id = $1`,
    [channelId],
  );
  if (!rows[0]) {
    throw new Error("Dit kanaal is geen onderdeel van een spel");
  }
  return rows[0];
}

async function getActiveGameUser(userId) {
  const { rows } = await promisePool.query(
    `select *
      from games
      join game_players on gpl_gms_id = gms_id
      where gms_status <> $1 and gpl_slack_id = $2
      and not gpl_not_drawn
      order by gpl_status asc`,
    [gameStates.ended, userId],
  );
  return rows;
}

async function getGameName(gameName) {
  const { rows } = await promisePool.query(
    `select *
      from games
      where gms_name = $1`,
    [gameName],
  );
  if (!rows[0]) {
    throw new Error(`${t("TEXTNAMEINCORRECT")}`);
  }
  return rows[0];
}

async function getActiveGameName() {
  const { rows } = await promisePool.query(
    `select gms_name
      from games
      where gms_status <> $1`,
    [gameStates.ended],
  );
  return rows.map((x) => x.gms_name);
}

async function getNotDrawnPlayers(gameId) {
  const { rows } = await promisePool.query(
    `select * 
      from game_players
      where gpl_gms_id = $1
      and not gpl_drawn
      and gpl_status = $2`,
    [gameId, playerStates.alive],
  );

  await promisePool.query(
    `update game_players
      set gpl_not_drawn = 1
      where gpl_gms_id = $1
      and not gpl_drawn
      and gpl_status = $2`,
    [gameId, playerStates.alive],
  );
  return rows;
}

async function getPlayerList(gameId) {
  const { rows } = await promisePool.query(
    `select gpl_slack_id from game_players 
    where gpl_gms_id = $1 
    and not gpl_leader 
    and gpl_status <> $2`,
    [gameId, playerStates.viewer],
  );
  return rows;
}

async function getGameHasPlayer(gameId, userId) {
  const { rows } = await promisePool.query(
    `select * 
      from game_players
      join games on gms_id = gpl_gms_id
      where gpl_slack_id = $1
      and not gpl_status = $2
      and gms_id = $3`,
    [userId, playerStates.viewer, gameId],
  );
  return rows.length;
}

async function getGameHasViewer(gameId, userId) {
  const { rows } = await promisePool.query(
    `select * 
      from game_players
      where gpl_gms_id = $1
      and gpl_slack_id = $2
      and gpl_status = $3`,
    [gameId, userId, playerStates.viewer],
  );
  return rows.length;
}

async function getPoll(gmsId) {
  const { rows } = await promisePool.query(
    `select *
      from game_polls
      where gpo_gms_id = $1
      order by gpo_number desc
      limit 1`,
    [gmsId],
  );
  if (rows.length !== 1) {
    return {
      gpo_gms_id: gmsId,
      gpo_number: 0,
      gpo_status: pollStates.closed,
      gpo_slack_message_id: null,
    };
  }
  return rows[0];
}

async function logChannel(logInput) {
  await promisePool.query(
    `insert into game_channels
      (gch_gms_id, gch_slack_id, gch_name, gch_type, gch_user_created, gch_created_at)
      select $1,$2,$3,$4,$5, current_timestamp
      where not exists (
        select 'already exists'
        from game_channels
        where gch_gms_id = $6
        and gch_slack_id = $7
      )`,
    [
      logInput.gch_gms_id,
      logInput.gch_slack_id,
      logInput.gch_name,
      logInput.gch_type,
      logInput.gch_user_created,
      logInput.gch_gms_id,
      logInput.gch_slack_id,
    ],
  );
}

async function getChannel(gameId, channelType) {
  const { rows } = await promisePool.query(
    `select gch_slack_id from game_channels where gch_gms_id = $1 and gch_type = $2`,
    [gameId, channelType],
  );
  return rows[0].gch_slack_id;
}

async function logArchiveChannel(channelId) {
  try {
    await promisePool.query(
      `update game_channels set gch_archived = true where gch_slack_id = $1`,
      [channelId],
    );
  } catch (error) {
    console.log(error);
  }
}

async function getAllChannels(gameId) {
  const { rows } = await promisePool.query(
    `select gch_slack_id, gch_name from game_channels where gch_gms_id = $1 and not gch_archived order by gch_name`,
    [gameId],
  );
  return rows;
}

async function storeMessage(channelId, userId, ts, blocks, files, threadTs) {
  // Get channel type
  const { rows } = await promisePool.query(
    `select gch_gms_id, gch_type from game_channels where gch_slack_id = $1`,
    [channelId],
  );
  if (rows.length == 0) {
    return false;
  }

  const { rows: rows2 } = await promisePool.query(
    `select gpm_slack_ts from game_public_messages where gpm_slack_ts = $1`,
    [threadTs],
  );

  if (!rows2.length || !rows2[0].gpm_slack_ts) {
    if (threadTs) {
      console.log("unmatched thread: ", threadTs, "for message: ", ts);
    }
    threadTs = null;
  }

  // Store the message
  const result = await promisePool.query(
    `insert into game_public_messages 
    (gpm_gch_gms_id, gpm_gch_slack_id,gpm_gpl_gms_id, gpm_gpl_slack_id, gpm_slack_ts, gpm_blocks, gpm_files, gpm_thread_ts, gpm_created_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, current_timestamp)`,
    [
      rows[0].gch_gms_id,
      channelId,
      rows[0].gch_gms_id,
      userId,
      ts,
      blocks,
      files,
      threadTs,
    ],
  );
  return result;
}

async function threadIdsInChannelByDate(channelId, startDate, endDate) {
  // Time
  const dateStart = startDate + " 00:00:00";
  const dateEnd = endDate + " 23:59:59";

  // Get thread IDs
  const { rows } = await promisePool.query(
    `select distinct(gpm_thread_ts) from game_public_messages 
    where gpm_thread_ts is not null and
    gpm_created_at >= $1 and
    gpm_created_at < $2`,
    [dateStart, dateEnd],
  );
  return rows;
}

async function nonThreadedMessagesInChannelByDate(
  channelId,
  startDate,
  endDate,
) {
  // Time
  const dateStart = startDate + " 00:00:00";
  const dateEnd = endDate + " 23:59:59";

  //
  const { rows } = await promisePool.query(
    `select gpm_slack_ts, gpl_name, gpm_blocks, gpm_files, gpm_thread_ts, gpm_created_at, gch_gms_id
      from game_public_messages gpm
        join game_channels gch on gpm.gpm_gch_slack_id = gch.gch_slack_id
          join game_players gpl on gpm.gpm_gpl_slack_id = gpl.gpl_slack_id and gpl.gpl_gms_id = gch.gch_gms_id
      where 
        gpm_gch_slack_id = $1 and
        gpm_thread_ts is null and
        gpm_created_at >= $2 and
        gpm_created_at < $3
      order by gpm_created_at`,
    [channelId, dateStart, dateEnd],
  );
  return rows;
}

async function threadedMessagesInChannelByTS(channelId, ts) {
  //
  const { rows } = await promisePool.query(
    `select gpm_slack_ts, gpl_name, gpm_blocks, gpm_files, gpm_thread_ts, gpm_created_at, gch_gms_id
      from game_public_messages gpm
        join game_channels gch on gpm.gpm_gch_slack_id = gch.gch_slack_id
          join game_players gpl on gpm.gpm_gpl_slack_id = gpl.gpl_slack_id and gpl.gpl_gms_id = gch.gch_gms_id
      where 
        gpm_gch_slack_id = $1 and
        gpm_thread_ts = $2
      order by gpm_created_at`,
    [channelId, ts],
  );
  return rows;
}
