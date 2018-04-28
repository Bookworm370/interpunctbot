// gets a quote from a server's pastebin quote page

const commands = new (require("../Commands"));
const o = require("../options");
const PastebinAPI = require("pastebin-js");
const pastebin = new PastebinAPI();

function escapeMarkdown(text) {
  let unescaped = text.replace(/\\(\*|_|`|~|\\)/g, "$1"); // unescape any "backslashed" character
  let escaped = unescaped.replace(/(\*|_|`|~|\\)/g, "\\$1"); // escape *, _, `, ~, \
  return escaped;
}

function deUsererrorIfy(str) {
  return str.toLowerCase();
}

commands.registerCommand("quote", [o.pm(false), data => data.quotesPastebin/*requireRank("configurator")*/], async(data, ...searchString) => {
  let forceLine;
  if(searchString.length > 0 && searchString[searchString.length - 1].match(/^\d+$/)) forceLine = parseInt(searchString.pop(), 10);
  searchString = searchString.join` `.toLowerCase().split` `;
  let allQuotes = escapeMarkdown(await pastebin.getPaste(data.quotesPastebin)
    .catch(async e => await data.msg.reply("Failed to get quotes"))
  ).split`\r`.join``.split(/\n{2,}/).filter(q=>q.match(/[A-Za-z]/)); // Death:
  if(searchString) {
    allQuotes = allQuotes
      .filter(q => searchString.every(z=>deUsererrorIfy(q).indexOf(z) > -1));
  }
  if(allQuotes.length < 1) allQuotes = [`No quotes found for ${searchString}`];
  let line = Math.floor(Math.random() * allQuotes.length);
  if(forceLine != null) line = forceLine-1;
  if(line < 0) line = 0;
  if(line > allQuotes.length - 1) line = allQuotes.length - 1;
  searchString.forEach(s => s ? allQuotes[line] = allQuotes[line].split(s).join(`**${s}**`) : 0);
  return await data.msg.reply(`${allQuotes[line]} (${line+1}/${allQuotes.length})`);
});

module.exports = commands;
