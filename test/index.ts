// @ts-nocheck
/*eslint-disable*/

import * as Discord from "discord.js";
import { readFileSync, promises as fs } from "fs";
import childProcess from "child_process";
import path from "path";
const config = JSON.parse(
	readFileSync(path.join(process.cwd(), "test", "config.json"), "utf-8"),
);

type TesterCallback = (t: TestHelper) => Promise<void>;

const testQueue: { reason: string; cb: TesterCallback }[] = [];

export function test(reason: string, cb: TesterCallback) {
	testQueue.push({ reason, cb });
}

export type PermissionRoleName =
	| "ADMINISTRATOR"
	| "VIEW_AUDIT_LOG"
	| "MANAGE_SERVER"
	| "MANAGE_ROLES"
	| "MANAGE_CHANNELS"
	| "KICK_MEMBERS"
	| "BAN_MEMBERS"
	| "CREATE_INVITE"
	| "CHANGE_NICKNAME"
	| "MANAGE_NICKNAMES"
	| "MANAGE_EMOJIS"
	| "READ_TEXT_CHANNELS_SEE_VOICE_CHANNELS"
	| "SEND_MESSAGES"
	| "SEND_TTS_MESSAGES"
	| "MANAGE_MESSAGES"
	| "EMBED_LINKS"
	| "ATTACH_FILES"
	| "READ_MESSAGE_HISTORY"
	| "MENTION_EVERYONE"
	| "USE_EXTERNAL_EMOJIS"
	| "ADD_REACTIONS";

type MessageHandler = (message: Discord.Message) => void;

const spawnedProcesses: childProcess.ChildProcess[] = [];

async function arrayToObject<
	Names extends Readonly<unknown[]>,
	CBKeys extends string,
	CBValue
>(
	names: Names,
	cb: (name: Names[number]) => Promise<{ key: CBKeys; value: CBValue }>,
): Promise<{ [key in CBKeys]: CBValue }> {
	const resobj: { [key in CBKeys]?: CBValue } = {};
	for (const name of names) {
		const { key, value } = await cb(name);
		resobj[key] = value;
	}
	return resobj as { [key in CBKeys]: CBValue };
}

type ChannelNameType = string | ChannelFullNameType;

type ChannelFullNameType = Readonly<
	| { name: string; type: "text" }
	| { name: string; type: "voice" }
	| { name: string; type: "category" }
>;

type ChannelName<T extends ChannelNameType> = T extends string
	? T
	: T extends { name: string }
	? T["name"]
	: never;

type ChannelType<T extends ChannelNameType> = T extends string
	? Discord.TextChannel
	: T extends { type: "text" }
	? Discord.TextChannel
	: T extends { type: "voice" }
	? Discord.VoiceChannel
	: T extends { type: "category" }
	? Discord.CategoryChannel
	: never;

export class TestHelper {
	adminClient: Discord.Client;
	adminGuild: Discord.Guild;
	adminIPBot: Discord.GuildMember;
	adminInteractionBot: Discord.GuildMember;

	botInteractionClient: Discord.Client; // bot that interacts with i;p
	botInteractionGuild: Discord.Guild;

	watchTime: number;

	private mostRecentEvents: any[];
	private noEventsTimeout?: NodeJS.Timeout; // on(event) clearTimeout(..) setTimeout(..)
	private noEventsCallback?: (events: any[]) => void;
	private watchEvents: boolean;

	private botProcess?: childProcess.ChildProcess;

	constructor(
		adminClient: Discord.Client,
		adminGuild: Discord.Guild,
		botInteractionClient: Discord.Client,
		botInteractionGuild: Discord.Guild,
	) {
		this.adminClient = adminClient;
		this.adminGuild = adminGuild;
		this.adminIPBot = adminGuild.members.resolve(config.ipbot)!;
		this.adminInteractionBot = adminGuild.members.resolve(config.testbot)!;

		this.botInteractionClient = botInteractionClient;
		this.botInteractionGuild = botInteractionGuild;

		this.watchTime = 2000;

		this.mostRecentEvents = [];
		this.watchEvents = false;

		const resetTimeout = () => {
			if (this.noEventsTimeout) {
				clearTimeout(this.noEventsTimeout);
			}
			this.noEventsTimeout = setTimeout(() => {
				if (this.noEventsCallback) {
					this.noEventsCallback(this.mostRecentEvents);
					this.mostRecentEvents = [];
					this.noEventsTimeout = undefined;
					this.watchEvents = false;
				} else {
					console.log(
						`Tried to report ${this.mostRecentEvents.length} events but there was no events callback. These events will be reported later.`,
					);
				}
			}, this.watchTime);
		};
		this.adminClient.on("message", message => {
			if (!this.watchEvents) {
				return;
			}
			if (message.channel?.type === "dm") {
				this.mostRecentEvents.push(
					`DM TO=${
						(message.channel as Discord.DMChannel).recipient
							.username
					}: ${message.author!.username}: ${message.cleanContent!}`,
				);
			} else {
				this.mostRecentEvents.push(
					`MSG #${(message.channel as Discord.TextChannel).name}: ${
						message.member!.displayName
					}: ${message.cleanContent!}`,
				);
			}
			if (message.embeds && message.embeds.length > 0) {
				this.mostRecentEvents.push(["embeds:", message.embeds]);
			}
			if (message.attachments && message.attachments.array().length > 0) {
				this.mostRecentEvents.push([
					"attachments:",
					message.attachments.array().map(a => a.toJSON()),
				]);
			}
			resetTimeout();
		});
		this.adminClient.on("channelUpdate", (fromChannel, toChannel) => {
			if (!this.watchEvents) {
				return;
			}
			this.mostRecentEvents.push(
				`CHANNEL #${(fromChannel as Discord.TextChannel).name} -> #${
					(toChannel as Discord.TextChannel).name
				}`,
			);
			resetTimeout();
		});
	}

	events(): Promise<any[]> {
		// await nextEvents()
		// next events until 2000ms after there are no more events
		return new Promise(r => {
			this.noEventsCallback = ev => r(ev);
		});
	}

	async startWatchingEvents() {
		this.watchEvents = true;
	}

	async createChannels<ChannelNames extends ChannelNameType[]>(
		...channelNames: Readonly<ChannelNames>
	): Promise<
		{
			[key in ChannelName<ChannelNames[number]>]: ChannelType<key>;
		}
	> {
		return ((await arrayToObject(
			channelNames,
			async (data: ChannelNameType) => {
				const channelToCreate: ChannelFullNameType =
					typeof data === "string"
						? { type: "text", name: data }
						: data;
				return {
					key: channelToCreate.name,
					value: await this.adminGuild.channels.create(
						channelToCreate.name,
						{ type: channelToCreate.type },
					),
				};
			},
		)) as unknown) as {
			[key in ChannelName<ChannelNames[number]>]: ChannelType<key>;
		};
	}

	async resetAll() {
		console.log("-- ResetAll");
		// remove all channels
		console.log("--- Removing channels");
		for (const channel of this.adminGuild.channels.cache.array()) {
			await channel.delete();
		}
		// remove all roles from ipbot
		console.log("--- Removing roles from bot");
		for (const role of this.adminIPBot.roles.cache.array()) {
			if (role.name === "@everyone") {
				continue;
			}
			await this.adminIPBot.roles.remove(role);
		}
		// remove all roles from tester
		console.log("--- Removing roles from tester");
		for (const role of this.adminInteractionBot.roles.cache.array()) {
			if (role.name === "@everyone") {
				continue;
			}
			await this.adminInteractionBot.roles.remove(role);
		}
		// remove database
		console.log("--- Removing database");
		try {
			await fs.unlink(path.join(process.cwd(), "data.db"));
		} catch (e) {}
		// create database
		console.log("--- Creating database");
		const createDB = childProcess.spawn(
			"yarn",
			["knex", "migrate:latest"],
			{
				cwd: path.join(process.cwd()),
			},
		);
		spawnedProcesses.push(createDB);
		const datahandler = (data: Buffer) => {
			console.log(
				`------- KNEX: ${data
					.toString()
					.split("\n")
					.join("\\n")}`,
			);
		};
		createDB.stdout.on("data", datahandler);
		createDB.stderr.on("data", datahandler);
		await new Promise<void>((r, re) => createDB.on("exit", () => r()));
		console.log("--- Resetting logs");
		const logs = await fs.readdir(path.join(process.cwd(), "logs"));
		for (const logfile of logs) {
			await fs.unlink(path.join(process.cwd(), "logs", logfile));
		}
		// done
		console.log("--- Everything Reset");
	}

	async permissions(
		bot: "testbot" | "ipbot",
		...permissions: PermissionRoleName[]
	) {
		const botMember =
			bot === "testbot" ? this.adminInteractionBot : this.adminIPBot;
		console.log(
			`----- Adding Permissions ${permissions.join(",")} to ${bot}`,
		);
		for (const permission of permissions) {
			console.log(
				`------------- Adding role ${permission} to ${botMember.displayName}`,
			);
			const role = this.adminGuild.roles.cache.find(
				r => r.name === permission,
			);
			if (!role) {
				console.log(
					`------------- The role named ${permission} does not exist in the testing server`,
				);
				throw new Error(
					`The role named ${permission} does not exist in the testing server`,
				);
			}
			await botMember.roles.add(role);
		}
	}

	async removePermissions(
		bot: "testbot" | "ipbot",
		...permissions: PermissionRoleName[]
	) {
		const botMember =
			bot === "testbot" ? this.adminInteractionBot : this.adminIPBot;
		console.log(
			`----- Adding Permissions ${permissions.join(",")} to ${bot}`,
		);
		for (const permission of permissions) {
			console.log(
				`------------- Adding role ${permission} to ${botMember.displayName}`,
			);
			const role = this.adminGuild.roles.cache.find(
				r => r.name === permission,
			);
			if (!role) {
				console.log(
					`------------- The role named ${permission} does not exist in the testing server`,
				);
				throw new Error(
					`The role named ${permission} does not exist in the testing server`,
				);
			}
			await botMember.roles.remove(role);
		}
	}

	async basePermissions(bot: "testbot" | "ipbot") {
		await this.permissions(
			bot,
			"READ_MESSAGE_HISTORY",
			"READ_TEXT_CHANNELS_SEE_VOICE_CHANNELS",
			"SEND_MESSAGES",
		);
	}

	startBot(): Promise<void> {
		console.log("--- Starting bot...");
		this.botProcess = childProcess.spawn("yarn", ["nyc", "node", "built"], {
			cwd: path.join(process.cwd()),
		});
		const botProcess = this.botProcess;
		spawnedProcesses.push(botProcess);
		return new Promise(resolve => {
			botProcess.stdout!.on("data", (data: Buffer) => {
				console.log(
					`------- BOT: ${data
						.toString()
						.split("\n")
						.join("\\n")}`,
				);
				if (data.toString() === "Ready\n") {
					console.log("--- Bot said Ready");
					resolve();
				}
			});
			botProcess.stderr!.on("data", (data: Buffer) => {
				console.log(
					`------- BOT ERR!: ${data
						.toString()
						.split("\n")
						.join("\\n")}`,
				);
			});
		});
	}

	async stopBot() {
		if (this.botProcess) {
			this.botProcess.kill();
		}
	}
}

(async () => {
	console.log("-- Compiling Code");
	const compileCode = childProcess.spawn("yarn", ["tsc"], {
		cwd: path.join(process.cwd()),
	});
	spawnedProcesses.push(compileCode);
	const datahandler = (data: Buffer) => {
		console.log(
			`------- Compiler: ${data
				.toString()
				.split("\n")
				.join("\\n")}`,
		);
	};
	compileCode.stdout.on("data", datahandler);
	compileCode.stderr.on("data", datahandler);
	await new Promise<void>((r, re) => compileCode.on("exit", () => r()));
	console.log("-- Ready");

	let exitCode = 0;
	const adminClient = new Discord.Client();
	adminClient.login(config.rolegiverToken).catch(e => console.log(e));
	const botInteractionClient = new Discord.Client();
	botInteractionClient.login(config.token).catch(e => console.log(e));
	const onReady = async () => {
		const adminGuild = adminClient.guilds.resolve(config.server)!;
		const botInteractionGuild = botInteractionClient.guilds.resolve(
			config.server,
		)!;
		const testHelper = new TestHelper(
			adminClient,
			adminGuild,
			botInteractionClient,
			botInteractionGuild,
		);
		let i = 0;
		for (const tester of testQueue) {
			console.log(
				`------ Testing ${tester.reason} (${i + 1} / ${
					testQueue.length
				})`,
			);
			let success = true;
			const startTime = new Date().getTime();
			try {
				await tester.cb(testHelper);
			} catch (e) {
				console.log(e);
				success = false;
				exitCode++;
			}
			const endTime = new Date().getTime();
			const ms = endTime - startTime;
			console.log(
				`------ Test ${success ? "PASSED" : "FAILED"} in ${ms}ms`,
			);
			i++;
			testHelper.stopBot().catch(e => console.log(e));
			testHelper.watchTime = 2000;
		}
		await new Promise(r => setTimeout(r, 1000)); //wait 1s before closing
		process.exit(exitCode);
	};
	let readyCount = 0;
	adminClient.on("ready", () => {
		readyCount++;
		if (readyCount >= 2) {
			onReady().catch(e => console.log(e));
		}
	});
	botInteractionClient.on("ready", () => {
		readyCount++;
		if (readyCount >= 2) {
			onReady().catch(e => console.log(e));
		}
	});
})().catch(e => console.log(e));

// kill children before exit
const cleanExit = () => {
	console.log("killing", spawnedProcesses.length, "child processes");
	spawnedProcesses.forEach(child => {
		if (!child.killed) {
			child.kill();
		}
	});
};
const cleanExitExit = () => {
	cleanExit();
	process.exit(1);
};
process.on("exit", cleanExit);
process.on("SIGINT", cleanExitExit);
process.on("SIGUSR1", cleanExitExit);
process.on("SIGUSR2", cleanExitExit);
process.on("uncaughtException", err => {
	console.log("UNCAUGHT EXCEPTION", err);
	cleanExitExit();
});
process.on("unhandledRejection", err => {
	console.log("UNCAUGHT PROMISE REJECTION", err);
	cleanExitExit();
});
