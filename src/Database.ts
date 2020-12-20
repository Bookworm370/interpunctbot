/*

await db.getPrefix(guild.id, prefix)

*/

import { globalKnex } from "./db";
import { logError } from "..";

type GuildData = { [key in keyof Fields]?: Fields[key] };

type AutodeleteInfo = {
	prefix: { prefix: string };
	user: { user: string };
	channel: { channel: string };
	role: { role: string };
	counting: { channel: string };
};
type AutodeleteDuration =
	| number
	| {
			type: "autoreact";
			reactions: string[];
	  };
type OneAutodeleteRule<key extends keyof AutodeleteInfo> = {
	type: key;
	duration: AutodeleteDuration;
	apply_roles?: {
		exclude: string[];
		include_only: string[];
	};
};
export type AutodeleteRule = {
	[key in keyof AutodeleteInfo]: AutodeleteInfo[key] & OneAutodeleteRule<key> & {id: number};
}[keyof AutodeleteInfo];
export type AutodeleteRuleNoID = {
	[key in keyof AutodeleteInfo]: AutodeleteInfo[key] & OneAutodeleteRule<key> & {id?: number};
}[keyof AutodeleteInfo];

export type CustomCommand =
	| { type: "list"; pastebin: string }
	| { type: "command"; text: string };
type CustomCommandsFieldRaw = { [key: string]: string | CustomCommand };
export type CustomCommandsField = { [key: string]: CustomCommand };

export type AutodeleteField = {
	rules: AutodeleteRule[];
	nextID: number;
};
export type QuickrankField = {
	nameAlias: { [safeLCName: string]: { name: string; role: string } };
	timeAlias: { ms: number; ltgt: "<" | ">"; role: string }[];
	emojiAlias: { [key: string]: { role: string } };
	providesAlias: { [roleID: string]: { role: string }[] };
	managerRole?: string;
};
export type Event =
	| {
			action: "none";
	  }
	| {
			action: "message";
			message: string;
			channel: string;
	  };
export type Events = {
	userJoin?: Event;
	userLeave?: Event;
};
export type TicketMessageType =
	// clicking the join button when you already have a ticket
	| "doublejoin"
	// assigning the ticket to yourself
	| "selfassign"
;
export type TicketConfig = {
	main: {
		/// category id
		category?: string;
		/// message id (globally unique but channel is included for resolution if necessary)
		invitation?: { channel: string; message: string };
		joinmsg?: string;
		logs?: { uploads: string; pretty: string };
		transcripts?: string;
		/// autodelete ms
		autoclose?: number;
		/// time to delete ms
		deletetime?: number;
		ping?: string;
		enable_assignment?: boolean;
			// {Mention} is mention, {Name} is name
		messages?: {[key in TicketMessageType]?: string};
	};
};

const cache: Map<string, GuildData> = new Map();
const shouldCache: { [ey: string]: boolean | undefined } = {
	prefix: true,
	logging: true,
	rankmojiChannel: true,
	autodelete: true,
	quickrank: true, // why can't we just cache everything for now
	managebotrole: true,
	channeloptions: true,
	ticket: true,
};

function tryParse<T>(json: string | undefined, defaultValue: T): T {
	if (!json) {
		return defaultValue;
	}
	if (typeof json !== "string") return json; // ? not sure why this is needed
	try {
		return JSON.parse(json);
	} catch (e) {
		console.log("!! JSON PARSE FAILED !!");
		console.log(json);
		console.log("^^ JSON PARSE FAILED ^^");
		logError(new Error(`Malformed JSON: ${json}`));
		return defaultValue;
	}
}

type Fields = {
	id: string;
	prefix: string;
	searchablePastebins?: string;
	logging?: string;
	quotes?: string;
	nameScreening?: string;
	unknownCommandMessages?: string;
	failedPrecheckMessages?: string;
	channel_spacing?: string;
	speedrun?: string; // "gameID, categoryID"
	welcome?: string;
	goodbye?: string;
	// pmonfailure?: string;
	funEnabled?: string;
	rankmojiChannel: string;
	autodelete?: string;
	autodelete_limit?: number;
	quickrank?: string;
	quickrank_limit?: number;
	events?: string;
	nameScreening2?: string;
	managebotrole: string;
	channeloptions: string;
	ticket: string;
};

type JSONFields = {
	searchablePastebins: CustomCommandsFieldRaw;
	nameScreening: NameScreeningField;
	nameScreening2: NameScreeningField;
	autodelete: AutodeleteField;
	quickrank: QuickrankField;
	events: Events;
	managebotrole: { role: string };
	channeloptions: { [key: string]: ChannelOptions };
	ticket: TicketConfig;
};
type BooleanFields = {
	logging: boolean;
	channel_spacing: boolean;
	funEnabled: boolean;
};
type NameScreeningField = string[];
type ChannelOptions = { pinBottom?: string; lastestPinBottom?: string };
// type SpeedrunField = { gameID: string; categoryID: string };

const lock: { [key: string]: (() => void)[] } = {};

// database should be initialized with every Info
class Database {
	guild: string;
	_data?: Fields;
	static get cache() {
		return cache;
	}
	constructor(guildId: string) {
		this.guild = guildId;
		this._data = undefined;
		if (!cache.has(this.guild)) {
			cache.set(this.guild, {});
		}
	}
	async deleteAllData(): Promise<void> {
		cache.delete(this.guild);
		await globalKnex!("guilds")
			.where({ id: this.guild })
			.del();
	}
	async getOrLoadData(): Promise<Fields> {
		// loads data into the this.data.
		if (this._data) {
			return this._data;
		}

		let data = (await globalKnex!("guilds").where({ id: this.guild }))[0]; // THIS IS NOT THE RIGHT WAY
		if (!data) {
			if (lock[this.guild]) {
				await new Promise(r => lock[this.guild].push(() => r()));
				return this.getOrLoadData();
			}
			lock[this.guild] = [];
			// we need a better way to do this
			try {
				data = await globalKnex!("guilds").insert({
					id: this.guild,
					prefix: "ip!",
				});
			} catch (er) {
				console.log(
					`no db entry was found for guild id ${this.guild}, but a new one could not be created because `,
					er,
					`, the data was `,
					data,
					``,
				);
				throw new Error(
					`no db entry was found for guild id ${this.guild},`,
				);
			}
			const values = lock[this.guild];
			delete lock[this.guild];
			values.forEach(e => e());
		}
		this._data = data;
		return this._data!;
	}
	async _get<Name extends keyof Fields>(name: Name): Promise<Fields[Name]> {
		// returns a string
		// if (shouldCache[name]) {
		if (
			cache.has(this.guild) &&
			cache.get(this.guild)![name] !== undefined
		) {
			return cache.get(this.guild)![name]! as Fields[Name];
		}
		// }
		const data = await this.getOrLoadData();
		if (shouldCache[name]) {
			//eslint-disable-next-line require-atomic-updates
			cache.get(this.guild)![name] = data[name]; // if two of these happen at once, the cache could get written to twice at a time. that is (probably) fine
		}
		return data[name];
	}
	async _set<Name extends keyof Fields>(name: Name, value: Fields[Name]) {
		// value is a string // we need an updateMany function
		await globalKnex!("guilds")
			.where({ id: this.guild })
			.update({ [name]: value });
		if (shouldCache[name]) {
			cache.get(this.guild)![name] = value;
		}
		if (this._data) {
			// it doesn't really matter if we update data or not because we will probably be forgotten about immediately after this, but whatever makes it so you can .setPrefix() then .getPrefix() and print the new result
			this._data[name] = value;
		}
	}
	async _getJson<Name extends keyof JSONFields>(
		name: Name,
		defaultValue: JSONFields[Name],
	): Promise<JSONFields[Name]> {
		return tryParse(await this._get(name), defaultValue);
	}
	async _setJson<Name extends keyof JSONFields>(
		name: Name,
		newValue: JSONFields[Name],
	) {
		await this._set(name, JSON.stringify(newValue));
	}
	async _getBool<Name extends keyof BooleanFields>(
		name: Name,
		defaultValue: BooleanFields[Name],
	): Promise<BooleanFields[Name]> {
		let val = await this._get(name);
		if (!val) {
			val = defaultValue.toString();
		}
		return val === "true";
	}
	async _setBool<Name extends keyof BooleanFields>(
		name: Name,
		newValue: BooleanFields[Name],
	) {
		await this._set(name, newValue.toString());
	}

	async getPrefix(): Promise<string> {
		return (await this._get(`prefix`)) || "ip!";
	}
	async setPrefix(newPrefix: string) {
		await this._set("prefix", newPrefix);
	}
	async getEmojiRankChannel(): Promise<string | undefined> {
		return (await this._get(`rankmojiChannel`)) || "";
	}
	async setEmojiRankChannel(newChannel: string) {
		await this._set("rankmojiChannel", newChannel);
	}
	async getCustomCommands(): Promise<CustomCommandsField> {
		const quoteList = await this._get(`quotes`);
		const otherLists = await this._getJson("searchablePastebins", {}); // here is where we could actually update the database to store everything in searchablepastebins instead of quotes... maybe later
		if (quoteList && !otherLists.quote) {
			otherLists.quote = quoteList;
		} // otherlists.quote OVERRIDES QUOTE!!!
		const finalres: CustomCommandsField = {};
		for (const [k, v] of Object.entries(otherLists)) {
			if (typeof v === "string") {
				finalres[k] = { type: "list", pastebin: v };
			} else {
				finalres[k] = v;
			}
		}
		return finalres;
	}
	async setCustomCommands(newLists: CustomCommandsField) {
		await this._setJson("searchablePastebins", newLists); // otherlists.quote overrides quote therefore we don't need to parse out and set quote
	}
	async getAutoban(): Promise<NameScreeningField> {
		const existingNameScreening = await this._getJson("nameScreening", []);
		return await this._getJson("nameScreening2", existingNameScreening);
	}
	async setAutoban(newAutoban: NameScreeningField) {
		return await this._setJson("nameScreening2", newAutoban);
	}
	async getManageBotRole(): Promise<{ role: string }> {
		return await this._getJson("managebotrole", { role: "" });
	}
	async setManageBotRole(nmbr: string): Promise<void> {
		await this._setJson("managebotrole", { role: nmbr });
	}
	async getAutodeleteLimit(): Promise<number> {
		return (await this._get("autodelete_limit")) || 10;
	}
	async setAutodeleteLimit(newLimit: number) {
		return await this._set("autodelete_limit", newLimit);
	}
	async getChannelOptions() {
		return await this._getJson("channeloptions", {});
	}
	async setChannelOptions(newOpts: { [key: string]: ChannelOptions }) {
		return await this._setJson("channeloptions", newOpts);
	}
	async getAutodelete() {
		return await this._getJson("autodelete", { rules: [], nextID: 1 });
	}
	async addAutodelete(rule: AutodeleteRuleNoID | AutodeleteRule) {
		const autodelete = await this.getAutodelete();
		if (!rule.id) rule.id = autodelete.nextID++;
		autodelete.rules.push(rule as AutodeleteRule);
		await this._setJson("autodelete", autodelete);
		return rule.id;
	}
	async removeAutodelete(id: number) {
		const autodelete = await this.getAutodelete();
		autodelete.rules = autodelete.rules.filter(rule => rule.id !== id);
		return await this._setJson("autodelete", autodelete);
	}
	async getQuickrank(): Promise<QuickrankField> {
		const res = await this._getJson("quickrank", {
			nameAlias: {},
			timeAlias: [],
			emojiAlias: {},
			providesAlias: {},
		});
		if (!res.providesAlias) res.providesAlias = {};
		return res;
	}
	async setQuickrank(nv: QuickrankField): Promise<void> {
		return await this._setJson("quickrank", nv);
	}
	// BOOL, these could probably be condensed
	async getLogEnabled(): Promise<boolean> {
		// cached
		return await this._getBool("logging", /*default:*/ false);
	}
	async setLogEnabled(bool: boolean) {
		return await this._set("logging", bool.toString());
	}
	async getTicket(): Promise<TicketConfig> {
		return await this._getJson("ticket", {
			main: {},
		});
	}
	async setTicket(nt: TicketConfig): Promise<void> {
		return await this._setJson("ticket", nt);
	}
	async getUnknownCommandMessages(): Promise<"always" | "admins" | "never"> {
		const value = await this._get("unknownCommandMessages");
		if (value === "true") {
			return "always";
		}
		if (value === "admins") {
			return "admins";
		}
		if (value === "false") {
			return "never";
		}
		return "always"; // default
	}
	async setUnknownCommandMessages(bool: "always" | "admins" | "never") {
		if (bool === "always") {
			return await this._set("unknownCommandMessages", "true");
		}
		if (bool === "admins") {
			return await this._set("unknownCommandMessages", "admins");
		}
		if (bool === "never") {
			return await this._set("unknownCommandMessages", "false");
		}
	}
	async getCommandErrors(): Promise<"always" | "admins" | "never"> {
		const value = await this._get("failedPrecheckMessages");
		if (value === "true") {
			return "always";
		}
		if (value === "false") {
			return "admins";
		}
		if (value === "noone") {
			return "never";
		}
		return "always"; // default
	}
	async setCommandErrors(bool: "always" | "admins" | "never") {
		if (bool === "always") {
			return await this._set("failedPrecheckMessages", "true");
		}
		if (bool === "admins") {
			return await this._set("failedPrecheckMessages", "false");
		}
		if (bool === "never") {
			return await this._set("failedPrecheckMessages", "noone");
		}
	}
	// async getPMOnFailure(): Promise<"always" | "admins" | "never"> {
	// 	const value = await this._get("pmonfailure");
	// 	if (value === "true") {
	// 		return "always";
	// 	}
	// 	if (value === "false") {
	// 		return "admins";
	// 	}
	// 	if (value === "noone") {
	// 		return "never";
	// 	}
	// 	return "never"; // default
	// }
	// async setPMOnFailure(bool: "always" | "admins" | "never") {
	// 	if (bool === "always") {
	// 		return await this._set("pmonfailure", "true");
	// 	}
	// 	if (bool === "admins") {
	// 		return await this._set("pmonfailure", "false");
	// 	}
	// 	if (bool === "never") {
	// 		return await this._set("pmonfailure", "noone");
	// 	}
	// }
	async getAutospaceChannels() {
		return await this._getBool("channel_spacing", false);
	}
	async setAutospaceChannels(bool: boolean) {
		return await this._set("channel_spacing", bool.toString());
	}
	async getEvents() {
		const events = await this._getJson("events", {
			userJoin: undefined,
			userLeave: undefined,
		});
		if (!events.userLeave) {
			const goodbyeMessage = await this._get("goodbye");
			if (goodbyeMessage) {
				const updmessage = goodbyeMessage
					.split("%s")
					.join("{Name}")
					.split("@s")
					.join("{Mention}");
				events.userLeave = {
					action: "message",
					message: updmessage,
					channel: "{SystemMessagesChannel}",
				};
			} else {
				events.userLeave = { action: "none" }; // to prevent future refetching after events is re-saved.
			}
		}
		if (!events.userJoin) {
			const welcomeMessage = await this._get("welcome");
			if (welcomeMessage) {
				const updmessage = welcomeMessage
					.split("%s")
					.join("{Name}")
					.split("@s")
					.join("{Mention}");
				events.userJoin = {
					action: "message",
					message: updmessage,
					channel: "{SystemMessagesChannel}",
				};
			} else {
				events.userJoin = { action: "none" };
			}
		}
		return events;
	}
	async setEvents(newEvents: Events) {
		return await this._setJson("events", newEvents);
	}
	async getFunEnabled() {
		return await this._getBool("funEnabled", true);
	}
	async setFunEnabled(value: boolean) {
		return await this._setBool("funEnabled", value);
	}
	// async getSpeedrun() {
	// 	return await this._getJson("speedrunv2");
	// }
	async getSpeedrunDefault() {
		const [gameID, categoryID] = (
			(await this._get("speedrun")) || ""
		).split(`, `);
		if (!categoryID) {
			return undefined;
		} // category id will be undefined because [1] of .split will be undefined.
		return { gameID: gameID, categoryID: categoryID };
	}
	async setSpeedrunDefault(gameID: string, categoryID: string) {
		return await this._set("speedrun", `${gameID}, ${categoryID}`);
	}
	async disableSpeedrun() {
		return await this._set("speedrun", undefined);
	}
	async addError(error: string, settingCause: string) {
		// log for the ip!error log
		void error;
		void settingCause;
	}
}

export default Database;

/*

	return{
get/setPrefix			prefix = guild.prefix;
get/setLists			allPastebin = tryParse(guild.searchablePastebins) || allPastebin;
replaced			if(guild.quotes) allPastebin.quote = guild.quotes;
			speedrun = guild.speedrun;
unused			disabledCommands = tryParse(guild.disabledCommands) || disabledCommands;
			rankmojis = tryParse(guild.rankmojis) || rankmojis;
			rankmojiChannel = guild.rankmojiChannel;
get/setAutoban			nameScreening = tryParse(guild.nameScreening) || nameScreening;
			permReplacements = tryParse(guild.permreplacements) || permReplacements;
get/setLogEnabled			logging = guild.logging === "true" ? true : false;
get/setUnknownCommandMessages			unknownCommandMessages = guild.unknownCommandMessages === "true" || !guild.unknownCommandMessages ? true : false;
get/setFailedPrecheckMessages			failedPrecheckMessages = guild.failedPrecheckMessages === "true" || !guild.failedPrecheckMessages ? true : false;
			channelSpacing = guild.channel_spacing === "true" ? true : false;
			events.welcome = guild.welcome || events.welcome;
			events.goodbye = guild.goodbye || events.goodbye;
	};

*/
