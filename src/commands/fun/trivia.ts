import * as Discord from "discord.js";
import he from "he";
import { andlist, raw, safe } from "../../../messages";
import { setEditInterval } from "../../editInterval";
import * as nr from "../../NewRouter";
import { getURL } from "../speedrun";

declare namespace OpenTDB {
	type Difficulty = "easy" | "medium" | "hard";
	type Category =
		| "Any Category"
		| "General Knowledge"
		| "Entertainment: Books"
		| "Entertainment: Film"
		| "Entertainment: Music"
		| "Entertainment: Musicals &amp; Theatres"
		| "Entertainment: Television"
		| "Entertainment: Video Games"
		| "Entertainment: Board Games"
		| "Science &amp; Nature"
		| "Science: Computers"
		| "Science: Mathematics"
		| "Mythology"
		| "Sports"
		| "Geography"
		| "History"
		| "Politics"
		| "Art"
		| "Celebrities"
		| "Animals"
		| "Vehicles"
		| "Entertainment: Comics"
		| "Science: Gadgets"
		| "Entertainment: Japanese Anime &amp; Manga"
		| "Entertainment: Cartoon &amp; Animations";

	type Type = "multiple" | "boolean";

	type Response = {
		response_code: 0;
		results: Question[];
	};

	type Question = {
		category: Category;
		type: Type;
		difficulty: Difficulty;
		question: string;
		correct_answer: string;
		incorrect_answers: string[];
	};
}

function decodeHTML(html: string) {
	return he.decode(html);
}

const letterToEmojiMap: { [key: string]: string | undefined } = {
	"0": "0️⃣",
	"1": "1️⃣",
	"2": "2️⃣",
	"3": "3️⃣",
	"4": "4️⃣",
	"5": "5️⃣",
	"6": "6️⃣",
	"7": "7️⃣",
	"8": "8️⃣",
	"9": "9️⃣",
	a: "🇦",
	b: "🇧",
	c: "🇨",
	d: "🇩",
	e: "🇪",
	f: "🇫",
	g: "🇬",
	h: "🇭",
	i: "🇮",
	j: "🇯",
	k: "🇰",
	l: "🇱",
	m: "🇲",
	n: "🇳",
	o: "🇴",
	p: "🇵",
	q: "🇶",
	r: "🇷",
	s: "🇸",
	t: "🇹",
	u: "🇺",
	v: "🇻",
	w: "🇼",
	x: "🇽",
	y: "🇾",
	z: "🇿",
};
const unknownCharacterEmoji = "*️⃣";

const defaultEmojiOrder = [
	"🇦",
	"🇧",
	"🇨",
	"🇩",
	"🇪",
	"🇫",
	"🇬",
	"🇭",
	"🇮",
	"🇯",
	"🇰",
	"🇱",
	"🇲",
	"🇳",
	"🇴",
	"🇵",
];

nr.globalCommand(
	"/help/fun/trivia",
	"trivia",
	{
		usage: "trivia",
		description: "play a game of trivia",
		examples: [
			{
				in: "trivia",
				out: "{Screenshot|https://i.imgur.com/kejbm15.png}",
			},
		],
		perms: {fun: true},
	},
	nr.list(),
	async ([], info) => {
		if (info.myChannelPerms) {
			if (!info.myChannelPerms.has("ADD_REACTIONS")) {
				return await info.error(
					"I need permission to `add reactions` here to play trivia\n> https://interpunct.info/help/fun/trivia",
				);
			}
			if (!info.myChannelPerms.has("MANAGE_MESSAGES")) {
				return await info.error(
					"I need permission to `manage messages` here to remove people's reactions in trivia\n> https://interpunct.info/help/fun/trivia",
				);
			}
		}

		// fetch trivia question
		let triviaQuestion: OpenTDB.Question;
		{
			info.startLoading();
			const triviaResponse: OpenTDB.Response = await getURL`https://opentdb.com/api.php?amount=1`; // TODO other things
			if (triviaResponse.response_code !== 0) {
				throw new Error(
					`Nonzero response code on trivia. Response is: ${JSON.stringify(
						triviaResponse,
					)}`,
				);
			}
			triviaQuestion = triviaResponse.results[0];
			// await fetchProgressMessage.delete();
			info.stopLoading();
		}
		{
			let triviaChoices: {
				name: string;
				emoji: string;
			}[] = [];
			{
				const choiceNames = [
					triviaQuestion.correct_answer,
					...triviaQuestion.incorrect_answers,
				].sort();

				const getFirstCharacterEmoji = (choiceName: string) => {
					return (
						letterToEmojiMap[choiceName.charAt(0).toLowerCase()] ||
						unknownCharacterEmoji
					);
				};
				let useFirstCharacterEmoji = true;
				const emojiToAnswerMap: { [key: string]: string } = {};
				choiceNames.forEach(choice => {
					const firstCharacterEmoji = getFirstCharacterEmoji(choice);
					if (emojiToAnswerMap[firstCharacterEmoji])
						useFirstCharacterEmoji = false;
					emojiToAnswerMap[firstCharacterEmoji] = choice;
					triviaChoices.push({
						name: choice,
						emoji: firstCharacterEmoji,
					});
				});

				if (!useFirstCharacterEmoji) {
					triviaChoices = choiceNames.map((choice, i) => ({
						name: choice,
						emoji: defaultEmojiOrder[i],
					}));
				}
			}
			const triviaMessageHeader = safe`Trivia questions from <https://opentdb.com/>
**Category**: ${decodeHTML(triviaQuestion.category)}
**Difficulty**: ${decodeHTML(triviaQuestion.difficulty)}`;
			const gameMessage = await info.channel.send(
				`${triviaMessageHeader}
> When the question appears, react with the correct answer before the time runs out.`,
			);

			const playerResponses: {
				[id: string]: {
					choiceName: string;
					reactionPile: Discord.MessageReaction;
					time: number;
				};
			} = {};

			let state = { state: "running" } as
				| { state: "running" }
				| { state: "over"; winners: string[] };

			const reactionWatcher = info.handleReactions(
				gameMessage,
				async (reaction, user) => {
					if (state.state !== "running") {
						return;
					}
					const choice = triviaChoices.find(
						c => c.emoji === reaction.emoji.name,
					);
					if (!choice) {
						await reaction.users.remove(user.id);
						return;
					}
					const previousChoice = playerResponses[user.id];
					playerResponses[user.id] = {
						choiceName: choice.name,
						reactionPile: reaction,
						time: new Date().getTime(),
					};
					if (previousChoice) {
						await previousChoice.reactionPile.users.remove(user.id);
					}
				},
			);

			for (const choice of triviaChoices) {
				await gameMessage.react(choice.emoji);
			}

			const startTime = new Date().getTime();

			const updateResultMessage = () =>
				gameMessage.edit(
					triviaMessageHeader +
						safe`
**Question**: ${decodeHTML(triviaQuestion.question)}
**Answers**:
${raw(
		triviaChoices
			.map(({ name, emoji }) => {
				return `> ${emoji} - ${safe`${decodeHTML(name)}`}`;
			})
			.join("\n"),
	)}
${raw(
	state.state === "running"
		? `**Time Left**: ${(
		    (startTime + 20000 - new Date().getTime()) /
				1000
		  ).toFixed(0)}s`
		: `**Correct Answer**: ${
				triviaChoices.find(
				    cd => cd.name === triviaQuestion.correct_answer,
				)!.emoji
		  } - ${safe`${decodeHTML(triviaQuestion.correct_answer)}`}
**Winners**: ${
				andlist(state.winners.map(w => `<@${w}>`))
		  }`,
	)}`,
				);

			await updateResultMessage();
			const messageEdit = setEditInterval(async () => {
				await updateResultMessage();
				if (startTime + 30000 - new Date().getTime() < 0) {
					messageEdit.end();
				}
			});

			const selectionEndTimer = setTimeout(() => {
				reactionWatcher.end();
			}, 20000);

			await reactionWatcher.done;
			// await Promise.race([reactionWatcher.done, messageEdit.end()])
			// ^that would be nice because then maybe message edit errors would show instead of waiting 20 seconds
			// also maybe check if the original message is still there before sending an error
			// ^^oh do that
			messageEdit.end();
			clearTimeout(selectionEndTimer);

			const winners: { id: string; time: number }[] = [];
			Object.entries(playerResponses).forEach(
				([playerID, playerResponse]) => {
					if (
						playerResponse.choiceName ===
						triviaQuestion.correct_answer
					) {
						winners.push({
							id: playerID,
							time: playerResponse.time,
						});
					}
				},
			);
			state = {
				state: "over",
				winners: winners
					.sort((wa, wb) => wa.time - wb.time)
					.map(q => q.id),
			};
			await updateResultMessage();
		}
	},
);
