window.__ModuleLoader__.load({
	id: "dsh-websift",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var React = react.default !== undefined ? react.default : react;
		var h = React.createElement;
		var useState = React.useState;
		var useEffect = React.useEffect;

		var inject = ["slots"];

		var MODES = [
			{ id: "auto", label: "自动切换", hint: "每个新域名先试直连，慢于 1.2 秒或不通就走代理" },
			{ id: "always", label: "强制代理", hint: "所有页面一律走代理（海外站点通常更快）" },
			{ id: "never", label: "直接连接", hint: "不走代理（被墙的站点会打不开）" },
		];

		function labelOf(id) {
			for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i].label;
			return id || "未知";
		}

		var S = {
			wrap: { display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px", maxWidth: "640px" },
			lead: { fontSize: "12px", lineHeight: "1.65", opacity: 0.68 },
			card: {
				display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px", borderRadius: "10px",
				border: "1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28))",
			},
			cardHead: { fontSize: "12px", fontWeight: 600, opacity: 0.55, letterSpacing: ".02em" },
			branch: {
				border: "1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22))",
				borderRadius: "10px", padding: "0 12px",
			},
			summary: {
				cursor: "pointer", padding: "9px 0", fontSize: "12.5px", fontWeight: 600, opacity: 0.75,
				listStyle: "none", display: "flex", alignItems: "center", gap: "8px",
			},
			branchBody: { display: "flex", flexDirection: "column", gap: "8px", padding: "2px 0 12px" },
			row: { display: "grid", gridTemplateColumns: "104px 1fr", gap: "8px", alignItems: "center" },
			label: { fontSize: "12px", opacity: 0.7 },
			input: {
				font: "inherit", fontSize: "12.5px", padding: "6px 9px", borderRadius: "6px",
				border: "1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35))",
				background: "var(--dsw-alias-bg-layer-1,transparent)", color: "inherit",
				width: "100%", boxSizing: "border-box", outline: "none",
			},
			opt: {
				display: "flex", alignItems: "center", gap: "10px", width: "100%", textAlign: "left",
				padding: "8px 11px", borderRadius: "8px", fontSize: "13px", font: "inherit",
				color: "inherit", cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))",
				background: "transparent",
			},
			optOn: { border: "1px solid rgba(76,154,255,.65)", background: "rgba(76,154,255,.12)" },
			dot: {
				flex: "0 0 auto", width: "14px", height: "14px", borderRadius: "50%",
				border: "2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.55))", background: "transparent",
			},
			dotOn: { border: "4px solid #4c9aff" },
			optText: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
			optHint: { fontSize: "11.5px", opacity: 0.6 },
			switch: {
				display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
				padding: "8px 11px", borderRadius: "8px", cursor: "pointer", font: "inherit",
				color: "inherit", border: "1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))",
				background: "transparent", width: "100%", textAlign: "left",
			},
			switchOn: { border: "1px solid rgba(76,154,255,.65)", background: "rgba(76,154,255,.12)" },
			track: {
				flex: "0 0 auto", width: "34px", height: "18px", borderRadius: "9px",
				background: "rgba(127,127,127,.35)", position: "relative", transition: "background .15s",
			},
			trackOn: { background: "#2b6ef6" },
			knob: {
				position: "absolute", top: "2px", left: "2px", width: "14px", height: "14px", borderRadius: "50%",
				background: "#fff", transition: "left .15s",
			},
			knobOn: { left: "18px" },
			kv: { display: "grid", gridTemplateColumns: "86px 1fr", gap: "4px 10px", fontSize: "12px", opacity: 0.75 },
			kvKey: { opacity: 0.6 },
			note: { fontSize: "12px", color: "var(--dsw-alias-brand-primary,#4c9aff)", minHeight: "16px" },
			actions: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
			btn: {
				font: "inherit", fontSize: "12px", padding: "5px 12px", borderRadius: "6px", cursor: "pointer",
				color: "inherit", background: "transparent",
				border: "1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35))",
			},
			btnPrimary: {
				font: "inherit", fontSize: "12px", padding: "5px 14px", borderRadius: "6px", cursor: "pointer",
				color: "#fff", background: "#2b6ef6", border: "1px solid #2b6ef6",
			},
			btnOff: { opacity: 0.45, cursor: "default" },
		};

		function Panel() {
			var dataPair = useState(null);
			var data = dataPair[0], setData = dataPair[1];
			var formPair = useState({ proxyUrl: "", idleSec: "", port: "", chromePath: "", budgetChars: "", longBudget: "", shortMaxChars: "", midMaxChars: "", hugeMaxChars: "", shortBudget: "", midBudget: "", hugeBudget: "", cacheTtlMin: "", probeTimeoutMs: "", slowVisitMs: "", proxySites: "", cacheMax: "", pageWaitMs: "", waitMs: "", routeTtlMin: "", loginPollMs: "", loginStreak: "", loginTimeoutS: "", cdpTimeoutMs: "30000" });
			var form = formPair[0], setForm = formPair[1];
			var dirtyPair = useState(false);
			var dirty = dirtyPair[0], setDirty = dirtyPair[1];
			var busyPair = useState(false);
			var busy = busyPair[0], setBusy = busyPair[1];
			var candPair = useState([]);
			var candidates = candPair[0], setCandidates = candPair[1];
			var pickPair = useState(false);
			var pickOpen = pickPair[0], setPickOpen = pickPair[1];
			var detectPair = useState("");
			var detectMsg = detectPair[0], setDetectMsg = detectPair[1];
			var notePair = useState("");
			var note = notePair[0], setNote = notePair[1];

			function fill(j) {
				if (!j) return;
				setForm({
					proxyUrl: j.proxyUrl || "",
					idleSec: String(Math.round((Number(j.idleMs) || 300000) / 1000)),
					port: String(j.port || 9333),
					chromePath: j.chromePath || "",
					budgetChars: String(j.budgetChars || 3000),
					longBudget: String(j.longBudget || 3000),
					shortMaxChars: String(j.shortMaxChars || 3000),
					midMaxChars: String(j.midMaxChars || 15000),
					hugeMaxChars: String(j.hugeMaxChars || 50000),
					shortBudget: String(j.shortBudget || 1200),
					midBudget: String(j.midBudget || 1200),
					hugeBudget: String(j.hugeBudget || 4000),
					cacheTtlMin: String(j.cacheTtlMin || 15),
					probeTimeoutMs: String(j.probeTimeoutMs || 2500),
					slowVisitMs: String(j.slowVisitMs || 8000),
					proxySites: j.proxySitesRaw || "",
					cacheMax: String(j.cacheMax || 60),
					pageWaitMs: String(j.pageWaitMs || 45000),
					waitMs: String(j.waitMs || 0),
					routeTtlMin: String(j.routeTtlMin || 10),
					loginPollMs: String(j.loginPollMs || 1500),
					loginStreak: String(j.loginStreak || 3),
					loginTimeoutS: String(j.loginTimeoutS || 180),
					cdpTimeoutMs: String(j.cdpTimeoutMs || 30000),
				});
				setDirty(false);
			}

			function load(keepForm) {
				fetch("/_websift/settings", { headers: { accept: "application/json" } })
					.then(function (r) { return r.json(); })
					.then(function (j) {
						if (j && j.ok) { setData(j); if (!keepForm) fill(j); }
						else setNote("读取失败：" + ((j && j.error) || "unknown"));
					})
					.catch(function (e) { setNote("读取失败：" + (e && e.message ? e.message : e)); });
			}

			useEffect(function () { load(false); }, []);

			function post(body, okText) {
				setBusy(true); setNote("");
				fetch("/_websift/settings", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				})
					.then(function (r) { return r.json(); })
					.then(function (j) {
						setBusy(false);
						if (j && j.ok) { setData(j); fill(j); setNote(okText(j)); }
						else setNote("失败：" + ((j && j.error) || "unknown"));
					})
					.catch(function (e) { setBusy(false); setNote("失败：" + (e && e.message ? e.message : e)); });
			}

			function choose(mode) {
				if (busy || (data && data.mode === mode)) return;
				post({ mode: mode }, function (j) { return "代理已切到「" + labelOf(j.mode) + "」"; });
			}

			function toggleVisible() {
				if (busy) return;
				var next = !(data && data.visible);
				post({ visible: next }, function () {
					return next ? "已开启可视模式：下次打开网页会弹出窗口，你能看到我在做什么" : "已关闭可视模式：浏览器回到后台运行";
				});
			}

			function save() {
				var seconds = Number(form.idleSec);
				if (!isFinite(seconds) || seconds < 30 || seconds > 21600) { setNote("空闲关闭要在 30 – 21600 秒之间"); return; }
				var budget = Number(form.budgetChars);
				if (!isFinite(budget) || budget < 600 || budget > 20000) { setNote("默认摘要预算要在 600 – 20000 字符之间"); return; }
				var longBudget = Number(form.longBudget);
				if (!isFinite(longBudget) || longBudget < 800 || longBudget > 8000) { setNote("长页预算要在 800 – 8000 字符之间"); return; }
				var nums = {};
				var keys = ["shortMaxChars", "midMaxChars", "hugeMaxChars", "shortBudget", "midBudget", "hugeBudget", "cacheTtlMin", "probeTimeoutMs", "slowVisitMs", "cacheMax", "pageWaitMs", "waitMs", "routeTtlMin", "loginPollMs", "loginStreak", "loginTimeoutS", "cdpTimeoutMs"];
				for (var i = 0; i < keys.length; i++) {
					var v = Number(form[keys[i]]);
					if (!isFinite(v)) { setNote("高级设置里有非法数字：" + keys[i]); return; }
					nums[keys[i]] = Math.round(v);
				}
				var portNum = Number(form.port);
				if (!isFinite(portNum) || portNum < 1024 || portNum > 65535) { setNote("端口要在 1024 – 65535 之间"); return; }
				post(Object.assign({
					proxyUrl: form.proxyUrl.trim(),
					port: Math.round(portNum),
					proxySites: form.proxySites,
					idleMs: Math.round(seconds * 1000),
					chromePath: form.chromePath.trim(),
					budgetChars: Math.round(budget),
					longBudget: Math.round(longBudget),
				}, nums), function () { return "已保存，下次打开网页即生效"; });
			}

			function toggleFact() {
				if (busy) return;
				var next = !(data && data.factExempt);
				post({ factExempt: next }, function () {
					return next ? "事实句豁免已开：带单位的数字/版本号不会被门槛删掉" : "事实句豁免已关：所有句子按普通规则筛选";
				});
			}

			function toggleOfficialStack() {
				if (busy) return;
				var next = (data && data.stack === "official") ? "plugin" : "official";
				post({ stack: next }, function () {
					return next === "official"
						? "已切到官方 API：搜索走 ctx.web.search，抓取走 ctx.web.fetch（失败才回退浏览器）"
						: "已切回插件自带：搜索和抓取都走真浏览器";
				});
			}

			function toggleDock() {
				if (busy) return;
				var next = !dockOn;
				post({ showDock: next }, function () { return next ? "输入框开关已显示" : "输入框开关已隐藏（设置里还能改）"; });
			}

			function toggleQuiet() {
				if (busy) return;
				var next = !quietOn;
				post({ quiet: next }, function () { return next ? "安静模式已开：窗口最小化，不打扰你" : "安静模式已关：窗口会显示在前台"; });
			}

			function detectChrome() {
				setDetectMsg("探测中…");
				fetch("/_websift/chrome-candidates", { headers: { accept: "application/json" } })
					.then(function (r) { return r.json(); })
					.then(function (j) {
						var list = (j && j.candidates) || [];
						setCandidates(list);
						setPickOpen(true);
						setDetectMsg(list.length ? ("找到 " + list.length + " 个可用内核，点一个就用它") : "没探测到，手动填上面的路径");
					})
					.catch(function (e) { setDetectMsg("探测失败：" + String(e && e.message ? e.message : e)); });
			}

			var clashBusyPair = useState(false);
			var clashBusy = clashBusyPair[0], setClashBusy = clashBusyPair[1];
			var clashMsgPair = useState("");
			var clashMsg = clashMsgPair[0], setClashMsg = clashMsgPair[1];

			function startClash() {
				setClashBusy(true);
				setClashMsg("正在启动 Clash Verge…");
				fetch("/_websift/clash", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ action: "start" }),
				})
					.then(function (r) { return r.json(); })
					.then(function (j) {
						var c = (j && j.clash) || {};
						setClashMsg(j && j.ok
							? "已就绪" + (j.result && j.result.already ? "（本来就在跑）" : "") + " · 代理 " + (c.proxyUrl || "")
							: "没起来：" + ((j && j.result && j.result.error) || (j && j.error) || "未知原因"));
						load();
					})
					.catch(function (e) { setClashMsg("失败：" + String(e && e.message ? e.message : e)); })
					.then(function () { setClashBusy(false); });
			}

			function minimizeBrowserWindow() {
				if (busy) return;
				fetch("/_websift/window", {
					method: "POST", headers: { "content-type": "application/json" },
					body: JSON.stringify({ action: "minimize" }),
				})
					.then(function (r) { return r.json(); })
					.then(function (j) { setClashMsg(j && j.ok ? "已把浏览器窗口最小化" : ("没最小化：" + ((j && j.error) || "未知原因"))); })
					.catch(function (e) { setClashMsg("最小化失败：" + e.message); });
			}

			function toggleAutoMinimize() {
				if (busy) return;
				var next = !(data && data.autoMinimizeOnClash);
				post({ autoMinimizeOnClash: next }, function () {
					return next ? "启动代理后会自动最小化浏览器窗口" : "启动代理后不再自动最小化";
				});
			}

			function toggleAutoClash() {
				if (busy) return;
				var next = !(data && data.autoStartClash);
				post({ autoStartClash: next }, function () {
					return next ? "代理不通时会自动启动 Clash Verge" : "已关闭自动启动（只在点按钮时启动）";
				});
			}

			function reset() { post({ reset: true }, function () { return "已恢复默认设置"; }); }

			function edit(key, value) {
				var next = Object.assign({}, form);
				next[key] = value;
				setForm(next); setDirty(true);
			}

			var current = data && data.mode ? data.mode : "auto";
			var visible = !!(data && data.visible);
			var dockOn = !data || data.showDock !== false;
			var quietOn = !data || data.quiet !== false;
			var browser = (data && data.browser) || {};

			return h("div", { style: S.wrap },
				h("div", { style: S.lead },
					"这是 browser / web_digest 用的浏览器内核。按「主模块 → 分支」排列，改完点保存。"),

				h("div", { style: S.card },
					h("div", { style: S.cardHead }, "主模块 · 浏览器内核"),
					h("button", {
						type: "button", style: Object.assign({}, S.switch, dockOn ? S.switchOn : null),
						onClick: toggleDock, disabled: busy, "aria-pressed": dockOn ? "true" : "false",
					},
						h("span", { style: S.optText },
							h("span", null, "输入框显示开关"),
							h("span", { style: S.optHint }, dockOn ? "开：输入框右上角有「关 / 按需 / 强制」" : "关：输入框那边不显示任何 UI")),
						h("span", { style: Object.assign({}, S.track, dockOn ? S.trackOn : null) },
							h("span", { style: Object.assign({}, S.knob, dockOn ? S.knobOn : null) }))),
					h("button", {
						type: "button", style: Object.assign({}, S.switch, visible ? S.switchOn : null),
						onClick: toggleVisible, disabled: busy, "aria-pressed": visible ? "true" : "false",
					},
						h("span", { style: S.optText },
							h("span", null, "可视化浏览器"),
							h("span", { style: S.optHint }, visible ? "开：窗口常驻不关，你能看到每一步在做什么" : "关：headless，后台运行你看不到")),
						h("span", { style: Object.assign({}, S.track, visible ? S.trackOn : null) },
							h("span", { style: Object.assign({}, S.knob, visible ? S.knobOn : null) }))),
					h("button", {
						type: "button", style: Object.assign({}, S.switch, quietOn ? S.switchOn : null),
						onClick: toggleQuiet, disabled: busy, "aria-pressed": quietOn ? "true" : "false",
					},
						h("span", { style: S.optText },
							h("span", null, "安静模式"),
							h("span", { style: S.optHint }, quietOn ? "开：开窗即最小化，不抢全屏/前台，全程不置前（登录时才弹出）" : "关：每次操作把窗口置前，实时看到点哪翻哪")),
						h("span", { style: Object.assign({}, S.track, quietOn ? S.trackOn : null) },
							h("span", { style: Object.assign({}, S.knob, quietOn ? S.knobOn : null) }))),
					h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
						h("label", { style: S.label, htmlFor: "bk-chrome" }, "内核路径（留空 = 自动探测）"),
						h("input", {
							id: "bk-chrome", style: S.input, type: "text", spellCheck: false,
							placeholder: "留空 = 自动探测（Chrome / Edge / Brave / 应用自带内核）", value: form.chromePath,
							onChange: function (e) { edit("chromePath", e.target.value); },
						}),
						h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
							h("button", { type: "button", style: S.btn, onClick: detectChrome }, "自动探测"),
							h("button", {
								type: "button", style: S.btn,
								onClick: function () { edit("chromePath", ""); setPickOpen(false); setDetectMsg("已改为自动探测（保存后生效）"); },
							}, "留空 / 用自动"),
							detectMsg ? h("span", { style: { fontSize: "11.5px", opacity: 0.6 } }, detectMsg) : null),
						pickOpen && candidates.length
							? h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
								candidates.map(function (c) {
									var on = form.chromePath === c.path;
									return h("button", {
										key: c.path, type: "button",
										style: Object.assign({}, S.opt, on ? S.optOn : null),
										onClick: function () { edit("chromePath", c.path); setPickOpen(false); setDetectMsg("已选 " + c.label + "（保存后生效）"); },
									},
										h("span", { style: Object.assign({}, S.dot, on ? S.dotOn : null) }),
										h("span", { style: S.optText },
											h("span", null, c.label),
											h("span", { style: S.optHint }, c.path)));
								}))
							: null),
					h("div", { style: S.row },
						h("label", { style: S.label, htmlFor: "bk-port" }, "调试端口"),
						h("input", {
							id: "bk-port", style: S.input, type: "number", min: 1024, max: 65535, step: 1,
							value: form.port,
							onChange: function (e) { edit("port", e.target.value); },
						})),
					h("div", { style: S.row },
						h("label", { style: S.label, htmlFor: "bk-idle" }, "空闲关闭（可视化开时不生效）"),
						h("input", {
							id: "bk-idle", style: S.input, type: "number", min: 30, max: 21600, step: 30,
							value: form.idleSec,
							onChange: function (e) { edit("idleSec", e.target.value); },
						}))),

				h("details", { style: S.branch, open: true },
					h("summary", { style: S.summary }, "分支 · 代理"),
					h("div", { style: S.branchBody },
						MODES.map(function (m) {
							var on = current === m.id;
							return h("button", {
								key: m.id, type: "button", disabled: busy,
								style: Object.assign({}, S.opt, on ? S.optOn : null),
								onClick: function () { choose(m.id); }, "aria-pressed": on ? "true" : "false",
							},
								h("span", { style: Object.assign({}, S.dot, on ? S.dotOn : null) }),
								h("span", { style: S.optText },
									h("span", null, m.label, m.id === "auto" ? "（默认）" : ""),
									h("span", { style: S.optHint }, m.hint)));
						}),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-proxy" }, "代理地址"),
							h("input", {
								id: "bk-proxy", style: S.input, type: "text", spellCheck: false,
								placeholder: "http://127.0.0.1:7897", value: form.proxyUrl,
								onChange: function (e) { edit("proxyUrl", e.target.value); },
							})),
						h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28))" } },
							h("div", { style: { fontSize: "12px", fontWeight: 600, opacity: 0.55 } }, "Clash Verge（可选依赖）"),
							h("div", { style: { fontSize: "12px", lineHeight: 1.6, opacity: 0.82 } },
								(function () {
									var c = (data && data.clash) || {};
									return (c.running ? "● 运行中" : "○ 未运行") +
										" · 代理 " + (c.proxyUrl || "（未配置）") +
										"\n程序：" + (c.path || (data && data.clashDetected) || "（没找到，可点下面的按钮或在设置里填路径）");
								})()),
							h("div", { style: S.btns },
								h("button", {
									type: "button", style: Object.assign({}, S.btn, S.btnPrimary),
									disabled: clashBusy, onClick: startClash,
								}, clashBusy ? "启动中…" : "启动 Clash Verge"),
								h("button", { type: "button", style: S.btn, onClick: load }, "刷新状态"),
								h("button", {
									type: "button",
									style: Object.assign({}, S.btn, (data && data.autoStartClash) ? S.btnPrimary : null),
									onClick: toggleAutoClash,
								}, (data && data.autoStartClash) ? "自动启动：开" : "自动启动：关")),
								h("button", {
									type: "button", style: S.btn, onClick: minimizeBrowserWindow,
								}, "最小化窗口"),
								h("button", {
									type: "button",
									style: Object.assign({}, S.btn, (data && data.autoMinimizeOnClash) ? S.btnPrimary : null),
									onClick: toggleAutoMinimize,
								}, (data && data.autoMinimizeOnClash) ? "启动代理后最小化：开" : "启动代理后最小化：关"),
							clashMsg ? h("div", { style: { fontSize: "12px", opacity: 0.85 } }, clashMsg) : null,
							h("div", { style: { fontSize: "11.5px", lineHeight: 1.6, opacity: 0.55 } },
								"Clash Verge · 作者 zzzgydi 与 Clash Verge Rev 贡献者 · GPL-3.0",
								h("br"),
								h("a", {
									href: "https://github.com/clash-verge-rev/clash-verge-rev",
									target: "_blank", rel: "noreferrer",
									style: { color: "inherit", textDecoration: "underline" },
								}, "github.com/clash-verge-rev/clash-verge-rev"),
								"（插件不打包它，只在代理不通时帮你启动）")),

						h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
							h("label", { style: S.label, htmlFor: "bk-sites" }, "强制走代理的站点"),
							h("textarea", {
								id: "bk-sites", style: Object.assign({}, S.input, { minHeight: "86px", resize: "vertical", fontFamily: "ui-monospace,Consolas,monospace", lineHeight: "1.5" }),
								spellCheck: false, placeholder: "github.com, google.com",
								value: form.proxySites,
								onChange: function (e) { edit("proxySites", e.target.value); },
							}),
							h("div", { style: S.lead },
								"逗号或换行分隔，子域名自动命中（填 github.com 覆盖 gist.github.com）。" +
								"命中的站点直接走代理，不再做直连探测。直连本来就能用的站别往里加。")))),

				h("details", { style: S.branch },
					h("summary", { style: S.summary }, "分支 · 网页摘要"),
					h("div", { style: S.branchBody },
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-budget" }, "默认预算"),
							h("input", {
								id: "bk-budget", style: S.input, type: "number", min: 600, max: 20000, step: 100,
								value: form.budgetChars,
								onChange: function (e) { edit("budgetChars", e.target.value); },
							})),
						h("div", { style: S.lead }, "一次摘要返回多少字符（多页平分）。更细的分档在下面的高级设置里。"))),

				h("details", { style: S.branch },
					h("summary", { style: S.summary }, "高级设置 · 一般不用动"),
					h("div", { style: S.branchBody },
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-shortMaxChars" }, "短页阈值"),
							h("input", {
								id: "bk-shortMaxChars", style: S.input, type: "number", min: 500, max: 20000, step: 100,
								value: form.shortMaxChars,
								onChange: function (e) { edit("shortMaxChars", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-midMaxChars" }, "中页阈值"),
							h("input", {
								id: "bk-midMaxChars", style: S.input, type: "number", min: 2000, max: 60000, step: 500,
								value: form.midMaxChars,
								onChange: function (e) { edit("midMaxChars", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-hugeMaxChars" }, "超长页阈值"),
							h("input", {
								id: "bk-hugeMaxChars", style: S.input, type: "number", min: 20000, max: 200000, step: 5000,
								value: form.hugeMaxChars,
								onChange: function (e) { edit("hugeMaxChars", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-shortBudget" }, "短页预算"),
							h("input", {
								id: "bk-shortBudget", style: S.input, type: "number", min: 240, max: 4000, step: 100,
								value: form.shortBudget,
								onChange: function (e) { edit("shortBudget", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-midBudget" }, "中页预算"),
							h("input", {
								id: "bk-midBudget", style: S.input, type: "number", min: 240, max: 6000, step: 100,
								value: form.midBudget,
								onChange: function (e) { edit("midBudget", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-longBudget" }, "长页预算"),
							h("input", {
								id: "bk-longBudget", style: S.input, type: "number", min: 800, max: 8000, step: 100,
								value: form.longBudget,
								onChange: function (e) { edit("longBudget", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-hugeBudget" }, "超长页预算"),
							h("input", {
								id: "bk-hugeBudget", style: S.input, type: "number", min: 500, max: 12000, step: 100,
								value: form.hugeBudget,
								onChange: function (e) { edit("hugeBudget", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-cacheTtlMin" }, "缓存有效期"),
							h("input", {
								id: "bk-cacheTtlMin", style: S.input, type: "number", min: 1, max: 1440, step: 1,
								value: form.cacheTtlMin,
								onChange: function (e) { edit("cacheTtlMin", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-probeTimeoutMs" }, "探测超时"),
							h("input", {
								id: "bk-probeTimeoutMs", style: S.input, type: "number", min: 300, max: 10000, step: 100,
								value: form.probeTimeoutMs,
								onChange: function (e) { edit("probeTimeoutMs", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-slowVisitMs" }, "慢站阈值"),
							h("input", {
								id: "bk-slowVisitMs", style: S.input, type: "number", min: 2000, max: 60000, step: 500,
								value: form.slowVisitMs,
								onChange: function (e) { edit("slowVisitMs", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-pageWaitMs" }, "页面等待上限"),
							h("input", {
								id: "bk-pageWaitMs", style: S.input, type: "number", min: 3000, max: 120000, step: 1000,
								value: form.pageWaitMs,
								onChange: function (e) { edit("pageWaitMs", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-waitMs" }, "默认额外等待"),
							h("input", {
								id: "bk-waitMs", style: S.input, type: "number", min: 0, max: 20000, step: 100,
								value: form.waitMs,
								onChange: function (e) { edit("waitMs", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-routeTtlMin" }, "路由缓存"),
							h("input", {
								id: "bk-routeTtlMin", style: S.input, type: "number", min: 1, max: 1440, step: 1,
								value: form.routeTtlMin,
								onChange: function (e) { edit("routeTtlMin", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-cacheMax" }, "缓存条数"),
							h("input", {
								id: "bk-cacheMax", style: S.input, type: "number", min: 5, max: 500, step: 5,
								value: form.cacheMax,
								onChange: function (e) { edit("cacheMax", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-loginPollMs" }, "登录轮询间隔"),
							h("input", {
								id: "bk-loginPollMs", style: S.input, type: "number", min: 500, max: 10000, step: 250,
								value: form.loginPollMs,
								onChange: function (e) { edit("loginPollMs", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-loginStreak" }, "登录连续确认"),
							h("input", {
								id: "bk-loginStreak", style: S.input, type: "number", min: 1, max: 10, step: 1,
								value: form.loginStreak,
								onChange: function (e) { edit("loginStreak", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-loginTimeoutS" }, "登录默认超时"),
							h("input", {
								id: "bk-loginTimeoutS", style: S.input, type: "number", min: 20, max: 600, step: 10,
								value: form.loginTimeoutS,
								onChange: function (e) { edit("loginTimeoutS", e.target.value); },
							})),
						h("div", { style: S.row },
							h("label", { style: S.label, htmlFor: "bk-cdpTimeoutMs" }, "CDP 超时（毫秒）"),
							h("input", {
								id: "bk-cdpTimeoutMs", style: S.input, type: "number", min: 3000, max: 120000, step: 1000,
								value: form.cdpTimeoutMs,
								onChange: function (e) { edit("cdpTimeoutMs", e.target.value); },
							})),
						h("button", {
							type: "button", style: Object.assign({}, S.switch, (data && data.factExempt) ? S.switchOn : null),
							onClick: toggleFact, disabled: busy, "aria-pressed": (data && data.factExempt) ? "true" : "false",
						},
							h("span", { style: S.optText },
								h("span", null, "事实句豁免"),
								h("span", { style: S.optHint }, (data && data.factExempt) ? "开：带单位的数字/版本号不会被门槛删掉" : "关：所有句子按普通规则筛")),
							h("span", { style: Object.assign({}, S.track, (data && data.factExempt) ? S.trackOn : null) },
								h("span", { style: Object.assign({}, S.knob, (data && S.knobOn && data.factExempt) ? S.knobOn : null) }))),
						h("button", {
							type: "button", style: Object.assign({}, S.switch, (data && data.stack === "official") ? S.switchOn : null),
							onClick: toggleOfficialStack, disabled: busy, "aria-pressed": (data && data.stack === "official") ? "true" : "false",
						},
							h("span", { style: S.optText },
								h("span", null, "使用官方 API",
									h("span", {
										title: "官方 API：搜索走 ctx.web.search、抓取走 ctx.web.fetch。\n不推荐 —— 摘要与压缩本来就是本插件的活，官方只负责取料；\n而且 DSH 同时注册多个 search provider 时，必须先在设置里指定一个，否则会报 ambiguous。\n默认关闭。想对比两条链路的效果，可以临时打开。",
										style: { marginLeft: 6, cursor: "help", opacity: 0.6, fontSize: 12, fontWeight: 400 },
										"aria-label": "官方 API 的说明",
									}, "ⓘ")),
								h("span", { style: S.optHint }, (data && data.stack === "official") ? "开：搜索走 ctx.web.search，抓取走 ctx.web.fetch（失败回退浏览器）" : "关：搜索和抓取都走插件自带的真浏览器（默认）")),
							h("span", { style: Object.assign({}, S.track, (data && data.stack === "official") ? S.trackOn : null) },
								h("span", { style: Object.assign({}, S.knob, (data && S.knobOn && data.stack === "official") ? S.knobOn : null) }))),
						h("div", { style: S.lead },
							"默认值都是跑过基准定的：短/中预算 1200，长页 3000（32k 字文档召回 61%），" +
							"超长 4000。改之前建议先看 README 里那张表——再多给 25% 预算只多 6 个点召回。"))),

				h("div", { style: S.actions },
					h("button", {
						type: "button", disabled: busy || !dirty,
						style: Object.assign({}, S.btnPrimary, busy || !dirty ? S.btnOff : null),
						onClick: save,
					}, dirty ? "保存" : "已保存"),
					h("button", { type: "button", style: S.btn, disabled: busy, onClick: reset }, "恢复默认"),
					h("button", { type: "button", style: S.btn, disabled: busy, onClick: function () { load(dirty); } }, "刷新状态")),

				h("div", { style: S.note }, note),

				data
					? h("div", { style: S.kv },
						h("span", { style: S.kvKey }, "浏览器"),
						h("span", null, browser.running
							? "运行中 · " + (browser.proxy ? "走代理" : "直连") + (visible ? " · 窗口可见" : " · 后台")
							: "未启动（首次调用时自动拉起）"),
						h("span", { style: S.kvKey }, "调试端口"),
						h("span", null, String(data.port || "—")),
						h("span", { style: S.kvKey }, "配置文件"),
						h("span", { style: { wordBreak: "break-all", opacity: 0.85 } }, data.settingsPath || "—"))
					: null);
		}

		/** 输入框旁边的一个小开关：关掉后宿主侧直接拒绝调用，不启动浏览器。 */
		function DockToggle(props) {
			var sid = (props && (props.sessionId || (props.session && props.session.id) || props.id)) || "";
			var pair = useState(null);
			var showPair = useState(true);
			var show = showPair[0], setShow = showPair[1];
			var usage = pair[0], setUsage = pair[1];

			useEffect(function () {
				fetch("/_websift/settings?session=" + encodeURIComponent(sid), { headers: { accept: "application/json" } })
					.then(function (r) { return r.json(); })
					.then(function (j) { if (j && j.ok) { setUsage(j.usage || "auto"); setShow(j.showDock !== false); } })
					.catch(function () {});
			}, []);

			function pick(next) {
				if (next === usage) return;
				var prev = usage;
				setUsage(next);
				fetch("/_websift/settings", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ usage: next, sessionId: sid }),
				}).catch(function () { setUsage(prev); });
			}

			var MODES = [
				{ id: "off", text: "关", tip: "不联网：我不会再调用浏览器，调用会被直接拒绝" },
				{ id: "auto", text: "按需", tip: "由我判断：需要网页内容时才用浏览器" },
				{ id: "force", text: "强制", tip: "强制：涉及网络的内容必须实际抓取核实，不许凭记忆回答" },
			];
			var cur = usage || "auto";
			if (!show) return null;

			return h("div", {
				style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "6px", width: "100%", padding: "2px 2px 0" },
			},
				h("span", { style: { fontSize: "11px", opacity: 0.45 } }, "🌐 浏览器"),
				h("span", {
					style: {
						display: "inline-flex", borderRadius: "999px", overflow: "hidden",
						border: "1px solid rgba(127,127,127,.32)",
					},
				},
					MODES.map(function (m, i) {
						var on = cur === m.id;
						return h("button", {
							key: m.id, type: "button", title: m.tip, onClick: function () { pick(m.id); },
							style: {
								font: "inherit", fontSize: "11px", lineHeight: "1.5", padding: "1px 9px",
								cursor: "pointer", whiteSpace: "nowrap", border: "none",
								borderLeft: i === 0 ? "none" : "1px solid rgba(127,127,127,.25)",
								background: on ? "rgba(76,154,255,.16)" : "transparent",
								color: "inherit", fontWeight: on ? 600 : 400,
								opacity: on ? 1 : 0.62,
							},
						}, m.text);
					})));
		}


		function apply(ctx) {
			ctx.slots.inject("conversation.input.dock", function () {
				return ctx.slots.register(
					{ name: "conversation.input.dock", id: "websift-toggle", order: 30 },
					DockToggle);
			});

			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register(
					{ name: "settings.section", id: "dsh-websift", order: 60, label: "网页筛 · 压缩检索" },
					Panel);
			});
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
