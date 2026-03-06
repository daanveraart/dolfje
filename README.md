# Dolfje een MNOT Weerwolf bot

Deze bot is geschreven om het weerwolven spel op de MNOT weerwolven slack te begeleiden.
Wij spelen het spel met een (of meerdere) verteller(s) die het spel leiden.
Speel een keer mee op https://mnot.nl/weerwolvenslack !

## Let op!

Dit is versie 3, voor de oude versie met MariaDB kijk naar de branch v2.

## Installatie handleiding

Dolfje is als klein project begonnen en beetje uit de hand gelopen.
Het ondersteund meerdere spellen, maar maar 1 Slack te tegelijkertijd, als je dus ook van Dolfje gebruik wilt maken zal je het zelf moeten hosten.
Hieronder een beknopt stappen plan.

### Maak een nieuwe Slack app

```
Op https://api.slack.com/apps kan je een nieuwe app aan maken, het makkelijkst is omdat direct in de Slack te doen waar je Dolfje wilt gebruiken
```

### Maak de database aan

```
De wwmnot.sql maakt de database aan zoals je hem nodig hebt. Dolfje gebruikt een PostgreSQL database.
Wil je een ander type database wilt gebruiken zal je zelf de code daar voor moeten aanpassen.
```

### Maak een .env file aan

```
In voorbeeld.env staat welke regels er in je .env file moeten komen te staan
```

Belangrijkste variabelen:

- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASS`
- `DB_DATABASE`
- `DB_SCHEMA` (optioneel, standaard `public`)
- `MNOT_ADMIN_PASS`
- `APPLANG` (`nl` of `en`)
- `REG_CHANNEL`

De databaseverbinding wordt in de code opgebouwd uit de `DB_*` variabelen.
Daarnaast gebruikt Dolfje PostgreSQL `search_path` op basis van `DB_SCHEMA`.

### Installeer NodeJS

```
Installeer NodeJS en installeer de benodige packages.
```

De Slack integratie gebruikt `@slack/bolt` in combinatie met `@slack/web-api`.

### Draai container

Draai de container en forward port 6262 vanuit de container door naar een url.
Controleer in je Slack app dat slash commands/interactivity naar je Dolfje endpoint wijzen.

## Handleidng

De gebruikershandleiding kan je hier vinden:
https://metnerdsomtafel.nl/wiki/index.php/Dolfje

## Credit

Dolfje is gemaakt door foaly, Martin en Vincent met vertaalhulp van Maikel en testhulp van oa Thijs, deWhiskyNerd, Ferry, Gerine, Luca, Soof, Jessica, Annabel, Slapstick, Sarah, Coen, Marieke, Lotte, William, Stef, Arnoud, Nini, Rob, Hannah, Dina, Margriet en Xander.
Je kunt ons vinden op onze weerwolf slack https://mnot.nl/weerwolvenslack
Heb je vragen, tips, opmeringen, suggesties of wil je iets anders over Dolfje kwijt mag je op die Slack altijd foaly DMen!
Wil je je dankbaarheid tonen, mag je altijd een kop thee voor me kopen ;) https://paypal.me/foaly
