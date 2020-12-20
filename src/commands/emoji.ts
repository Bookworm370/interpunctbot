import * as Discord from "discord.js";
import { messages } from "../../messages";
import Info from "../Info";
import * as nr from "../NewRouter";

nr.addDocsWebPage(
	"/help/emoji",
	"Emoji",
	"commands for managing emoji",
	`{Title|Emoji}

{Interpunct} has the ability to restrict emojis so only people with certain roles can use them.

{CmdSummary|emoji restrict}
{CmdSummary|emoji unrestrict}
{CmdSummary|emoji inspect}`,
);

function roleNameMatch(rolename: string, message: string) {
	const rn = rolename.trim().toLowerCase();
	const rm = message.trim().toLowerCase();
	return rn === rm || `@${rn}` === rm;
}

async function getEmojiAndRole(
	cmd: string,
	info: Info,
	{ allowJustEmoji }: { allowJustEmoji: false },
): Promise<{ emoji: Discord.GuildEmoji; role: Discord.Role } | undefined>;
async function getEmojiAndRole(
	cmd: string,
	info: Info,
	{ allowJustEmoji }: { allowJustEmoji: true },
): Promise<
	| { emoji: Discord.GuildEmoji; role: Discord.Role }
	| { emoji: Discord.GuildEmoji; role: undefined }
	| undefined
>;
async function getEmojiAndRole(
	cmd: string,
	info: Info,
	{ allowJustEmoji }: { allowJustEmoji: boolean },
): Promise<
	| { emoji: Discord.GuildEmoji; role: Discord.Role }
	| { emoji: Discord.GuildEmoji; role: undefined }
	| undefined
> {
	if (!info.guild) {
		await info.error(messages.failure.command_cannot_be_used_in_pms(info));
		return;
	}
	if (!cmd.trim()) {
		await info.error(messages.emoji.restrict_usage(info));
		return;
	}
	const [, emojiID, rolename] = /^[\S\s]*?([0-9]{16,})[^ ]*? (.+)$/.exec(
		cmd,
	) || ["", "", ""];

	if (!emojiID || !rolename) {
		if (allowJustEmoji) {
			//eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
			const [, emojiID] = cmd
				.trim()
				.match(/^[\S\s]*?([0-9]{16,})[^ ]*$/) || ["", ""];
			if (!emojiID) {
				await info.error(
					messages.emoji.could_not_find_emoji(info, emojiID),
				);
				return;
			}

			const emoji = info.guild.emojis.resolve(emojiID);
			if (!emoji) {
				await info.error(
					messages.emoji.could_not_find_emoji(info, emojiID),
				);
				return;
			}

			return { emoji: emoji, role: undefined };
		}
		await info.error(messages.emoji.restrict_usage(info));
		return;
	}

	const emoji = info.guild.emojis.resolve(emojiID);
	if (!emoji) {
		await info.error(messages.emoji.could_not_find_emoji(info, emojiID));
		return;
	}

	//eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
	const roleID = (rolename.trim().match(/^[\S\s]*?([0-9]{16,})[\S\s]*$/) || [
		"",
		"",
	])[1];
	let role: Discord.Role;
	if (roleID) {
		const foundRole = info.guild.roles.resolve(roleID);
		if (!foundRole) {
			await info.error(messages.emoji.role_does_not_exist(info, roleID));
			return;
		}
		role = foundRole;
	} else {
		const matchingRoles = info.guild.roles.cache
			.array()
			.filter(role => roleNameMatch(role.name, rolename));
		if (matchingRoles.length > 1) {
			await info.error(
				messages.emoji.multiple_roles_found(
					info,
					rolename,
					matchingRoles,
				),
			);
			return;
		}
		if (matchingRoles.length === 0) {
			await info.error(messages.emoji.no_roles_found(info, rolename));
			return;
		}
		role = matchingRoles[0];
	}

	return { emoji, role };
}

nr.globalCommand(
	"/help/emoji/restrict",
	"emoji restrict",
	{
		usage:
			"emoji restrict {Required|{Emoji|emoji}} {Required|{Role|role list}}",
		description:
			"restrict an emoji so only people with one of the specified roles can use it",
		examples: [],
		perms: { runner: ["manage_emoji"], bot: ["manage_emoji"] },
	},
	nr.list(nr.a.emoji(), ...nr.a.role()),
	async ([emoji, role], info) => {
		const newRoles = emoji.roles.cache.array();
		newRoles.push(role);
		await emoji.edit(
			{ roles: newRoles },
			`@${info.message.member!.displayName}`,
		);
		await info.success(
			messages.emoji.added_restriction(info, emoji, role, newRoles),
		);
	},
);

nr.globalCommand(
	"/help/emoji/unrestrict",
	"emoji unrestrict",
	{
		usage:
			"emoji unrestrict {Optional|{Emoji|emoji}} {Optional|{Role|role}}",
		description: "unrestrict an emoji so anyone can use it",
		examples: [],
		perms: { runner: ["manage_emoji"], bot: ["manage_emoji"] },
	},
	nr.passthroughArgs,
	async ([cmd], info) => {
		if (!info.guild) {
			return await info.error(
				messages.failure.command_cannot_be_used_in_pms(info),
			);
		}

		const emojiAndRole = await getEmojiAndRole(cmd, info, {
			allowJustEmoji: true,
		});
		if (!emojiAndRole) {
			return;
		}
		const { emoji, role } = emojiAndRole;

		let newRoles = emoji.roles.cache.array();

		// note that emojirolestore.set() and .add() exist. this way makes it possible to set a reason and await for completion.

		if (!role) {
			await emoji.edit(
				{ roles: [] },
				`@${info.message.member!.displayName}`,
			);
			return await info.success(
				messages.emoji.removed_all_restrictions(info, emoji),
			);
		}
		newRoles = newRoles.filter(roles => roles.id !== role.id);
		await emoji.edit(
			{ roles: newRoles },
			`@${info.message.member!.displayName}`,
		);
		await info.success(
			messages.emoji.removed_restriction(info, emoji, role, newRoles),
		);
	},
);

nr.globalCommand(
	"/help/emoji/inspect",
	"emoji inspect",
	{
		usage: "emoji inspect {Required|{Emoji|emoji}}",
		description: "get information about an emoji",
		examples: [],
		perms: {},
	},
	nr.list(nr.a.emoji()),
	async ([emoji], info) => {
		await info.result(messages.emoji.inspect(info, emoji));
	},
);
