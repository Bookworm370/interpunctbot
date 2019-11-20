import { promises as fs } from "fs";
import * as path from "path";

import { parseDGMD } from "./dgmd";

type Context = { emojiCont: { [key: string]: [string, string, string] } };

export function raw(string: TemplateStringsArray | string) {
	return { __raw: `${string}` };
}

export function templateGenerator<InType>(helper: (str: InType) => string) {
	type ValueArrayType = (InType | string | { __raw: string })[];
	return (strings: TemplateStringsArray, ...values: ValueArrayType) => {
		const result: ValueArrayType = [];
		strings.forEach((str, i) => {
			result.push(raw(str), values[i] || "");
		});
		return result
			.map(el =>
				typeof (el as { __raw: string }).__raw === "string"
					? (el as { __raw: string }).__raw
					: helper(el as InType)
			)
			.join("");
	};
}

export function escapeHTML(html: string) {
	return html
		.split("&")
		.join("&amp;")
		.split('"')
		.join("&quot;")
		.split("<")
		.join("&lt;")
		.split(">")
		.join("&gt;");
}

let global_context: Context; // don't do this. instead, remove phtml and call htmlprocess manually and pass in a context argument.

export const rhtml = templateGenerator((v: string) => v);
export const html = templateGenerator((v: string) => escapeHTML(v)); // could be replaced with jsx
export const phtml = templateGenerator((v: string) => htmlprocess(v));

async function recursiveReaddir(start: string): Promise<string[]> {
	const files = await fs.readdir(start);
	const finalFiles: string[] = [];
	await Promise.all(
		files.map(async f => {
			const fileStats = await fs.stat(path.join(start, f));
			if (fileStats.isDirectory()) {
				finalFiles.push(
					...(await recursiveReaddir(path.join(start, f))).map(r =>
						path.join(f, r)
					)
				);
			} else {
				finalFiles.push(f);
			}
		})
	);
	return finalFiles;
}

type Methods = "Channel" | "Link" | "Command" | "Bold" | "Argument";

const htmlmethods: { [key: string]: (v: string) => string } = {
	Channel: v => rhtml`<a class="tag">${v}</a>`,
	Link: v => rhtml`<a href="${v}">${v}</a>`, // very basic version
	Command: v => rhtml`<code class="inline">ip!${v}</code>`,
	Bold: v => rhtml`<b>${v}</b>`,
	Argument: v => v,
	Srclink: v => rhtml`<sup><a href="" title="view source">src</a></sup>`,
	Newline: () => rhtml`<br />`,
	Blockquote: v =>
		rhtml`<div class="blockquote-container"><div class="blockquote-divider"></div><blockquote>${v}</blockquote></div>`,
	Emoji: v => {
		const [, emojiurl, emojiname] = global_context.emojiCont[v] || [
			"",
			"err_no_emoji",
			":err_no_emoji:"
		];
		return rhtml`<img class="emoji" src="${emojiurl}" title="${emojiname}" aria-label="${emojiname}" alt="${emojiname}" draggable="false" />`;
	},
	Image: v => rhtml`<img src="${v}" class="sizimg" />`,
	Interpunct: v => htmlmethods.Atmention("inter·punct"),
	Atmention: v => rhtml`<a class="tag">@${v}</a>`
};

const discordmethods: { [key: string]: (v: string) => string } = {
	Channel: v => `#${v}`,
	Link: v => `<${v}>`, // very basic version
	Command: v => `{{Computed|prefix}}${v}`,
	Bold: v => `**${v}**`,
	Argument: v => v,
	Srclink: v => "",
	Newline: () => "\n",
	Blockquote: v =>
		v
			.split("\n")
			.map(l => `> ${l}`)
			.join("\n"),
	Emoji: v => (global_context.emojiCont[v] || ["err_no_emoji"])[0],
	Image: v => `<${v}> (image)`,
	Interpunct: v => `{{Computed|atme}}`,
	Atmention: v => `@${v}`
};

const htmlprocess = (str: string) =>
	parseDGMD(str, {
		cleanText: str => escapeHTML(str),
		callFunction: (name, v) => {
			const method = htmlmethods[name];
			if (method) {
				return method(v);
			}
			console.log(`Unsupported HTML function ${name}`);
			return html`
				<span class="callerr">${name}|${v}</span>
			`;
		}
	}).res;

const discordprocess = (str: string) =>
	parseDGMD(str, {
		cleanText: str => escapeHTML(str),
		callFunction: (name, v) => {
			const method = discordmethods[name];
			if (method) {
				return method(v);
			}
			console.log(`Unsupported Discord function ${name}`);
			return html`
				\`{{${name}|${v}</span>}}\`
			`;
		}
	}).res;

async function processText(
	path: string[],
	text: string,
	context: Context
): Promise<{ html: string; discord: string }> {
	const htmlResult: string[] = [];
	const discordResult: string[] = [];

	global_context = context; // don't do this. instead, remove phtml and call htmlprocess manually and pass in a context argument.

	const lines = text.split("\n");
	for (const line of lines) {
		if (line.startsWith("## ")) {
			const v = line.substr(3);
			htmlResult.push(
				phtml`
					<h2>${v}</h2>
				`
			);
			discordResult.push(`**${discordprocess(v)}**`);
			continue;
		}
		if (line.startsWith("*text*: ")) {
			const v = line.substr(8);
			htmlResult.push(
				phtml`
					<p>${v}</p>
				`
			);
			discordResult.push(discordprocess(v));
			continue;
		}
		if (line.startsWith(": ")) {
			const v = line.substr(2);
			htmlResult.push(
				phtml`
					<p>${v}</p>
				`
			);
			discordResult.push(discordprocess(v));
			continue;
		}
		if (line.startsWith("Command: ")) {
			const v = line.substr(9);
			htmlResult.push(
				phtml`
					<div class="message">
						<img
							class="profile"
							src="https://cdn.discordapp.com/embed/avatars/0.png"
						/>
						<div class="author you">you</div>
						<div class="msgcontent">ip!${v}</div>
					</div>
				`
			);
			// discordResult.push(`\`{{Computed|prefix}}${discordprocess(v)}\``);
			continue;
		}
		if (line.startsWith("Output: ")) {
			const v = line.substr(8);
			htmlResult.push(
				phtml`
					<div class="message">
						<img
							class="profile"
							src="https://cdn.discordapp.com/avatars/433078185555656705/bcc3d8799adc00afd50b9c3168b4743e.png"
						/>
						<div class="author bot">
							inter·punct
							<span class="bottag">BOT</span>
						</div>
						<div class="msgcontent">${v}</div>
					</div>
				`
			);
			// discordResult.push(`→ ${discordprocess(v)}`);
			continue;
		}
		if (line.startsWith("*link*: ")) {
			const v = line.substring(19 + 1, line.length - 1);
			const respath = v.startsWith("/")
				? v.split("/").map(l => l)
				: [...path, ...v.split("/")];
			htmlResult.push(
				html`
					<p>
						<a href="/${respath.join("/")}"
							>${respath[respath.length - 1]}</a
						>
					</p>
				`
			);
			discordResult.push(`\`ip!${respath.join(" ")}\``);
			continue;
		}
		if (line.startsWith("*link web=inline*: ")) {
			const v = line.substring(19 + 1, line.length - 1);
			const respath = (v.startsWith("/")
				? v.split("/")
				: [...path, ...v.split("/")]
			).filter(l => l.trim());
			htmlResult.push(
				html`
					<p>
						<a inline="true" href="/${respath.join("/")}"
							>${respath[respath.length - 1]}</a
						>
					</p>
				`
			);
			discordResult.push(`\`ip!${respath.join(" ")}\``);
			continue;
		}
		if (!line.trim()) {
			// discordResult.push("");
			continue;
		}
		if (line.startsWith("*when discord*: ")) {
			const v = line.substr(16);
			discordResult.push(v);
			continue;
		}
		if (line.startsWith("//")) {
			continue;
		}
		if (line.startsWith("---")) {
			const v = line.substr(3).trim();
			htmlResult.push(
				phtml`
					<span class="divider">${v}</span>
				`
			);
			discordResult.push(line);
			continue;
		}
		console.log(`unrecognized:::${line}`);
		discordResult.push(`unrecognized:::${line}`);
		htmlResult.push(
			phtml`
				<p>unrecognized:::${line}</p>
			`
		);
		continue;
	}
	discordResult.push("", `> <https://interpunct.info/${path.join("/")}>`);
	return { html: htmlResult.join("\n"), discord: discordResult.join("\n") };
}

const dirname = (fullpath: string) =>
	fullpath.substr(0, fullpath.lastIndexOf("/"));

function category(name: string, link: string, active: boolean) {
	return html`
		<a class="category${active ? " active" : ""}" href="${link}">
			<svg
				class="category-collapse"
				width="24"
				height="24"
				viewBox="0 0 24 24"
			>
				<path
					fill="currentColor"
					fill-rule="evenodd"
					clip-rule="evenodd"
					d="M16.59 8.59004L12 13.17L7.41 8.59004L6 10L12 16L18 10L16.59 8.59004Z"
				></path>
			</svg>
			<header class="category-name">
				${name}
			</header>
		</a>
	`;
}

function channel(name: string, url: string, active: boolean) {
	return html`
		<a class="channel${active ? " active" : ""}" href="${url}">
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				class="channel-icon"
			>
				<path
					fill="currentColor"
					fill-rule="evenodd"
					clip-rule="evenodd"
					d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41045 9L8.35045 15H14.3504L15.4104 9H9.41045Z"
				></path>
			</svg>
			<div class="channel-name">${name.toLowerCase()}</div>
		</a>
	`;
}

function sidebar(
	thisurl: string,
	json: [string, string, string | undefined][]
) {
	const items: string[] = [];
	json.forEach(([type, link, name]) => {
		if (!name) name = path.basename(link);
		if (type === "category") {
			items.push(category(name, link, thisurl === link));
		}
		if (type === "channel") {
			items.push(channel(name, link, thisurl === link));
		}
	});
	return html`
		<div class="banner">
			<a class="banner-header" href="/">
				<div class="banner-icon"></div>
				<h1 class="banner-name">inter·punct bot</h1>
				<svg
					class="banner-dropdown"
					width="24"
					height="24"
					viewBox="0 0 24 24"
				>
					<path
						fill="currentColor"
						fill-rule="evenodd"
						clip-rule="evenodd"
						d="M16.59 8.59004L12 13.17L7.41 8.59004L6 10L12 16L18 10L16.59 8.59004Z"
					></path>
				</svg>
			</a>
			<div
				class="banner-image-container"
				style="opacity: 1; transform: translateY(0px);"
			>
				<div
					class="banner-image"
					style='background-image: url("/logo.png"); background-image: url("/logo.svg"); transform: translateY(0px) scale(1); background-position: center center; background-size: 50%; background-color: rgb(239, 71, 71);'
				></div>
			</div>
		</div>
		<div class="scroll-container">
			<div style="width: 100%; height: 84px; visibility: hidden;"></div>
			<div style="height: 16px;"></div>
			${raw(items.join(" "))}
			<div style="height: 16px;"></div>
		</div>
	`;
}

async function copyFolder(dir: string, to: string) {
	const filesToCopy = await recursiveReaddir(dir);
	for (const fileToCopy of filesToCopy) {
		await fs.mkdir(path.join(to, dirname(fileToCopy)), {
			recursive: true
		});
		await fs.copyFile(
			path.join(dir, fileToCopy),
			path.join(to, fileToCopy)
		);
	}
}

(async () => {
	const start = path.join(__dirname, "../doc/content");
	try {
		await fs.rmdir(path.join(__dirname, "../dist"), { recursive: true });
	} catch (e) {}
	await copyFolder(
		path.join(__dirname, "../doc/public"),
		path.join(__dirname, "../dist")
	);
	await copyFolder(
		path.join(__dirname, "../doc/public2"),
		path.join(__dirname, "../dist")
	);
	const discorddist = path.join(__dirname, "../dist/discord");
	const webdist = path.join(__dirname, "../dist/web");
	const filesToProcess = (await recursiveReaddir(start)).filter(f =>
		f.endsWith(".dg")
	);
	const htmlTemplate = await fs.readFile(
		path.join(__dirname, "../doc/template.html"),
		"utf-8"
	);

	const sidebarItems: string[] = [];
	const sidebarJSON = await fs.readFile(
		path.join(__dirname, "../doc/sidebar.json"),
		"utf-8"
	);
	const sidebarCont = JSON.parse(sidebarJSON);

	const emojiJSON = await fs.readFile(
		path.join(__dirname, "../doc/emoji.json"),
		"utf-8"
	);
	const emojiCont = JSON.parse(emojiJSON);

	let completed = 0;
	const count = filesToProcess.length;
	const logProgress = () =>
		process.stdout.write(`\r... (${completed} / ${count})`);
	logProgress();

	await Promise.all(
		filesToProcess.map(async f => {
			const fileCont = await fs.readFile(path.join(start, f), "utf-8");
			const { html, discord } = await processText(
				dirname(f).split("/"),
				fileCont,
				{ emojiCont }
			);
			const discordfile = path.join(
				discorddist,
				f.replace(/\.dg$/, ".md")
			);
			const sidebart = sidebar(`/${dirname(f)}`, sidebarCont);
			const webfile = path.join(webdist, f.replace(/\.dg$/, ".html"));
			await fs.mkdir(dirname(discordfile), { recursive: true });
			await fs.mkdir(dirname(webfile), { recursive: true });
			await fs.writeFile(discordfile, discord, "utf-8");
			await fs.writeFile(
				webfile,
				htmlTemplate
					.replace("{{html|content}}", html)
					.replace("{{html|sidebar}}", sidebart),
				"utf-8"
			);
			completed++;
			logProgress();
		})
	);
	console.log();
})();
