require("dotenv").config();
const localizify = require("localizify");

const en = require("./en.json");
const nl = require("./nl.json");
localizify.default.add("en", en).add("nl", nl).setLocale(process.env.APPLANG);
const { App } = require("@slack/bolt");
const { WebClient } = require("@slack/web-api");
const ww_actions = require("./ww_actions");
const ww_commands = require("./ww_commands");
const ww_messages = require("./ww_messages");

const webClient = new WebClient(process.env.SLACK_BOT_TOKEN);

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

ww_actions.addActions(app, webClient);
ww_commands.addCommands(app, webClient);
ww_messages.addMessages(app, webClient);

// eslint-disable-next-line unicorn/prefer-top-level-await
app
  .start(6262)
  .then(() => console.log("dolfje is running"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
