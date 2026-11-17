window.__ModuleLoader__.load({ id: "dsh-thinking-guard", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
_deepseek_ai_dsh_client_ui_primitives = __toESM(_deepseek_ai_dsh_client_ui_primitives, 1);
//#region src/client/remote-mount.ts
/** Own asynchronous mounting without extending the plugin activation promise. */
function createRemoteMount(mount, resolve) {
	let state = { status: "loading" };
	let disposed = false;
	let started = false;
	let cleanup;
	const listeners = /* @__PURE__ */ new Set();
	const release = async (dispose) => {
		try {
			await dispose();
		} catch (error) {
			console.error("[capability-menu] remote disposal failed:", error);
		}
	};
	const run = async () => {
		try {
			const dispose = await mount();
			if (disposed) {
				await release(dispose);
				return;
			}
			cleanup = dispose;
			const remote = resolve();
			if (remote === void 0) throw new Error("capabilityPolicy remote unavailable after mounting");
			state = {
				status: "ready",
				remote
			};
		} catch (error) {
			if (disposed) return;
			console.error("[capability-menu] $mount failed:", error);
			state = {
				status: "error",
				error: String(error)
			};
		}
		if (!disposed) for (const listener of listeners) try {
			listener();
		} catch (error) {
			console.error("[capability-menu] remote state listener failed:", error);
		}
	};
	return {
		start() {
			if (started || disposed) return;
			started = true;
			run();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			listeners.clear();
			if (cleanup) {
				const dispose = cleanup;
				cleanup = void 0;
				release(dispose);
			}
		},
		getSnapshot: () => state,
		subscribe(listener) {
			if (disposed) return () => {};
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}
//#endregion
//#region src/client/settings-nav-icon.ts
/** Replace the settings shell's fallback gear with dsh's shared list glyph. */
const NAV_ICON_MARKER = "data-capability-menu-nav-icon";
const NAV_ROW_SELECTOR = "[role=\"dialog\"] nav button";
const NAV_ICON_SIZE = 16;
/** The geometry of dsh-client-ui-primitives' IconFlatListOutlineMedium. */
function flatListMaskUrl() {
	return `data:image/svg+xml,${encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"#000\" stroke-linecap=\"round\" stroke-width=\"1.3\"><path d=\"M6 3.5h7.5M6 8h7.5M6 12.5h7.5\"/><path d=\"M2.6 3.5h.01M2.6 8h.01M2.6 12.5h.01\"/></svg>")}`;
}
function navIconCss(maskUrl) {
	return [
		`[${NAV_ICON_MARKER}] > svg { display: none; }`,
		`[${NAV_ICON_MARKER}]::before {`,
		"  content: \"\";",
		"  flex: none;",
		`  width: ${NAV_ICON_SIZE}px;`,
		`  height: ${NAV_ICON_SIZE}px;`,
		"  background-color: currentColor;",
		`  -webkit-mask: url("${maskUrl}") center / ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px no-repeat;`,
		`  mask: url("${maskUrl}") center / ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px no-repeat;`,
		"}"
	].join("\n");
}
/**
* The current settings.section slot has no icon option. Match this plugin's
* localized nav label and replace only its fallback gear, as dsh-market does.
*/
function installSettingsNavIcon(ctx, resolveLabel) {
	if (typeof document === "undefined") return;
	ctx.effect(() => {
		const style = document.createElement("style");
		style.dataset.plugin = "capability-menu";
		style.dataset.pluginCss = "capability-menu/settings-nav-icon";
		style.textContent = navIconCss(flatListMaskUrl());
		document.head.appendChild(style);
		let disposed = false;
		let scheduled = false;
		const sync = () => {
			scheduled = false;
			if (disposed) return;
			const wanted = resolveLabel().trim();
			for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) if (wanted.length > 0 && row.textContent?.trim() === wanted) row.setAttribute(NAV_ICON_MARKER, "");
			else row.removeAttribute(NAV_ICON_MARKER);
		};
		const schedule = () => {
			if (scheduled || disposed) return;
			scheduled = true;
			queueMicrotask(sync);
		};
		sync();
		const observer = new MutationObserver(schedule);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true
		});
		return () => {
			disposed = true;
			observer.disconnect();
			for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER);
			style.remove();
		};
	}, "capability-menu: settings nav icon");
}
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function joinValues(array, separator = "|") {
	return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function cached(getter) {
	return { get value() {
		{
			const value = getter();
			Object.defineProperty(this, "value", { value });
			return value;
		}
	} };
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) {
		const descriptors = Object.getOwnPropertyDescriptors(def);
		Object.assign(mergedDescriptors, descriptors);
	}
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
const propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function stringifyPrimitive(value) {
	if (typeof value === "bigint") return value.toString() + "n";
	if (typeof value === "string") return `"${value}"`;
	return `${value}`;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
	});
}
const NUMBER_FORMAT_RANGES = /*@__PURE__*/ (() => ({
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = {};
			for (const key of Reflect.ownKeys(mask)) {
				if (!Object.prototype.hasOwnProperty.call(currDef.shape, key)) throw new Error(`Unrecognized key: "${String(key)}"`);
				if (!mask[key]) continue;
				assignProp(newShape, key, currDef.shape[key]);
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = { ...schema._zod.def.shape };
			for (const key of Reflect.ownKeys(mask)) {
				if (!Object.prototype.hasOwnProperty.call(currDef.shape, key)) throw new Error(`Unrecognized key: "${String(key)}"`);
				if (!mask[key]) continue;
				delete newShape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = schema._zod.def.shape;
		for (const key of Reflect.ownKeys(shape)) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function merge(a, b) {
	if (!b?._zod?.def) throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return clone(a, mergeDefs(a._zod.def, {
		get shape() {
			const _shape = {
				...a._zod.def.shape,
				...b._zod.def.shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		},
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask, name = "partial") {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key of Reflect.ownKeys(mask)) {
				if (!Object.prototype.hasOwnProperty.call(oldShape, key)) throw new Error(`Unrecognized key: "${String(key)}"`);
				if (!mask[key]) continue;
				shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
			}
			else for (const key of Reflect.ownKeys(oldShape)) shape[key] = Class ? new Class({
				type: "optional",
				innerType: oldShape[key]
			}) : oldShape[key];
			assignProp(this, "shape", shape);
			return shape;
		},
		checks: []
	}));
}
function required(Class, schema, mask) {
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const oldShape = schema._zod.def.shape;
		const shape = { ...oldShape };
		if (mask) for (const key of Reflect.ownKeys(mask)) {
			if (!Object.prototype.hasOwnProperty.call(shape, key)) throw new Error(`Unrecognized key: "${String(key)}"`);
			if (!mask[key]) continue;
			shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
		}
		else for (const key of Reflect.ownKeys(oldShape)) shape[key] = new Class({
			type: "nonoptional",
			innerType: oldShape[key]
		});
		assignProp(this, "shape", shape);
		return shape;
	} }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage$1(message) {
	return typeof message === "string" ? message : message?.message;
}
function attachSchema(issues, start, inst) {
	var _a;
	for (let i = start; i < issues.length; i++) (_a = issues[i]).schema ?? (_a.schema = inst);
}
function finalizeIssue(iss, ctx, config) {
	var _a;
	const traits = iss.inst?._zod?.traits;
	if (traits?.has("$ZodType")) {
		if (traits.has("$ZodCheck")) (_a = iss).schema ?? (_a.schema = iss.inst);
		else iss.schema = iss.inst;
	}
	const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
	const message = iss.message ? iss.message : unwrapMessage$1(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage$1(schemaError?.(iss)) ?? unwrapMessage$1(ctx?.error?.(iss)) ?? unwrapMessage$1(config.customError?.(iss)) ?? unwrapMessage$1(config.localeError?.(iss)) ?? "Invalid input";
	const { inst: _inst, schema: _schema, continue: _continue, input: _input, ...rest } = iss;
	rest.path ?? (rest.path = []);
	rest.message = message;
	if (ctx?.reportInput) rest.input = _input;
	return rest;
}
const highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
	const units = str.length;
	if (!highSurrogate.test(str)) return units;
	let count = units;
	for (let i = 0; i < units - 1; i++) if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
		count--;
		i++;
	}
	return count;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function parsedType(data) {
	const t = typeof data;
	switch (t) {
		case "number": return Number.isNaN(data) ? "nan" : "number";
		case "object": {
			if (data === null) return "null";
			if (Array.isArray(data)) return "array";
			const obj = data;
			if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) return obj.constructor.name;
		}
	}
	return t;
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
/**
* Installs a trait's members on its prototype. Each value builds that member for the instance on first read; the built value shadows the accessor as an own property, so a detached `const { parse } = schema` keeps working.
*
* Call this from a `proto` initializer, which runs once per prototype — never per instance.
*/
function members(proto, table) {
	for (const key in table) {
		const desc = Object.getOwnPropertyDescriptor(table, key);
		if (desc.get) Object.defineProperty(proto, key, {
			...desc,
			enumerable: false
		});
		else defineBound(proto, key, desc.value);
	}
}
/** Shadows a prototype member with an own value, so a getter that builds from the instance runs once. */
function own(inst, key, value, enumerable = true) {
	Object.defineProperty(inst, key, {
		configurable: true,
		writable: true,
		enumerable,
		value
	});
	return value;
}
/** Like {@link own}, for a member that was never an own data property and has to stay out of `Object.keys`. */
function hide(inst, key, value) {
	return own(inst, key, value, false);
}
function defineBound(proto, key, fn) {
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			return this == null ? fn : own(this, key, fn.bind(this));
		},
		set(value) {
			own(this, key, value);
		}
	});
}
/** Returns the prototype to install on, or `undefined` if this group is already installed on it. */
function claim(inst, sentinel) {
	const proto = Object.getPrototypeOf(inst);
	return sentinel in proto ? void 0 : proto;
}
let installing;
let broke = false;
const breaker = {
	configurable: true,
	get() {
		broke = true;
	}
};
/**
* Installs a lazily-derived internal on the `_zod` prototype of `inst`'s
* constructor, computed from the internals object itself and cached there on
* first read. One accessor per constructor rather than one per instance.
*/
function defineLazyInternal(inst, key, compute) {
	const proto = Object.getPrototypeOf(inst._zod);
	if (key in proto && installing !== inst._zod) {
		installing = void 0;
		return;
	}
	installing = inst._zod;
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			Object.defineProperty(this, key, breaker);
			const outer = broke;
			broke = false;
			try {
				const value = compute(this);
				if (broke) delete this[key];
				else Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					value
				});
				broke = broke || outer;
				return value;
			} catch (err) {
				delete this[key];
				broke = broke || outer;
				throw err;
			}
		},
		set(value) {
			Object.defineProperty(this, key, {
				configurable: true,
				writable: true,
				value
			});
		}
	});
}
/**
* Installs `key` on `inst`'s prototype, computed by `make` on first read and cached there as an own
* data property. One accessor per constructor rather than one per instance, because an own accessor
* puts every instance after the first into v8 dictionary mode. The key doubles as the sentinel.
*/
function installLazyProp(inst, key, make, enumerable) {
	const proto = claim(inst, key);
	if (!proto) return;
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			const desc = {
				configurable: true,
				writable: true,
				enumerable,
				value: void 0
			};
			Object.defineProperty(this, key, desc);
			desc.value = make(this);
			Object.defineProperty(this, key, desc);
			return desc.value;
		},
		set(value) {
			Object.defineProperty(this, key, {
				configurable: true,
				writable: true,
				enumerable,
				value
			});
		}
	});
}
/** Marks the thunk `_catch` synthesises for a constant catch value. `Function.length` cannot tell that thunk from a user callback — rest and defaulted parameters both report arity 0 — and a user callback reads `ctx.error`, whose issues only finalize correctly against the caller's per-parse error map. Provenance can say what arity cannot. A plain string key rather than `Symbol.for`, whose call at module scope no bundler can prove pure — the same shape that anchored `urlCanParse` into every build. */
const CONSTANT_CATCH = "~constantCatch";
/** Wraps a constant catch value in a thunk tagged with {@link CONSTANT_CATCH}. */
function constantCatch(value) {
	const fn = () => value;
	fn[CONSTANT_CATCH] = true;
	return fn;
}
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/core.js
var _a$1;
const _zodDesc$1 = {
	value: void 0,
	enumerable: false
};
let _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
	const E = _E;
	if (E) {
		const saved = E.stackTraceLimit;
		if (typeof saved === "number") {
			try {
				E.stackTraceLimit = 0;
			} catch {
				_E = null;
				return new Definition();
			}
			try {
				return new Definition();
			} finally {
				E.stackTraceLimit = saved;
			}
		}
	}
	return new Definition();
}
function $constructor(name, initializer, proto, params) {
	const zodProto = {};
	function Internals(def) {
		this.def = def;
		this.constr = _;
		this.traits = /* @__PURE__ */ new Set();
	}
	Internals.prototype = zodProto;
	const protoMembers = proto;
	const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
	function init(inst, def) {
		if (!inst._zod) {
			_zodDesc$1.value = new Internals(def);
			try {
				Object.defineProperty(inst, "_zod", _zodDesc$1);
			} finally {
				_zodDesc$1.value = void 0;
			}
		}
		if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		if (initialized) {
			const own = Object.getPrototypeOf(inst);
			const ctorProto = inst._zod.constr.prototype;
			let up = own;
			while (up && up !== ctorProto) up = Object.getPrototypeOf(up);
			const target = up ?? own;
			if (!initialized.has(target)) {
				initialized.add(target);
				members(target, protoMembers);
			}
		}
		const proto = _.prototype;
		for (const k in proto) {
			if (!Object.prototype.hasOwnProperty.call(proto, k)) continue;
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		const inst = params?.Parent ? newError(Definition) : this;
		init(inst, def);
		const deferred = inst._zod.deferred;
		if (deferred) {
			for (const fn of deferred) fn();
			inst._zod.deferred = void 0;
		}
		const pp = globalThis.__zod_globalConfig?.postProcessor;
		if (pp) pp(inst);
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/errors.js
function _getMessage() {
	const internals = this._zod;
	internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
	return internals.message;
}
function _setMessage(value) {
	this._zod.message = value;
}
const _messageDesc = {
	get: _getMessage,
	set: _setMessage,
	enumerable: true,
	configurable: true
};
const _zodDesc = {
	value: void 0,
	enumerable: false
};
const _issuesDesc = {
	value: void 0,
	enumerable: false
};
const _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
const initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	_zodDesc.value = inst._zod;
	Object.defineProperty(inst, "_zod", _zodDesc);
	_issuesDesc.value = def;
	Object.defineProperty(inst, "issues", _issuesDesc);
	_zodDesc.value = void 0;
	_issuesDesc.value = void 0;
	Object.defineProperty(inst, "message", _messageDesc);
	const proto = Object.getPrototypeOf(inst);
	if (!_installedToString.has(proto)) {
		_installedToString.add(proto);
		Object.defineProperty(proto, "toString", {
			configurable: true,
			enumerable: false,
			get() {
				const value = () => this.message;
				Object.defineProperty(this, "toString", {
					value,
					configurable: true,
					writable: true
				});
				return value;
			},
			set(value) {
				Object.defineProperty(this, "toString", {
					value,
					configurable: true,
					writable: true
				});
			}
		});
	}
};
const $ZodError = $constructor("$ZodError", initializer$1);
const $ZodRealError = $constructor("$ZodError", initializer$1, void 0, { Parent: Error });
/** Get-or-create `obj[key]` as an own data property. A path segment naming an inherited member
* ("toString", "constructor") would otherwise read through to the prototype, and assigning
* "__proto__" would hit the setter instead of creating a key. */
function node(obj, key, make) {
	if (!Object.prototype.hasOwnProperty.call(obj, key)) {
		if (key === "__proto__") Object.defineProperty(obj, key, {
			value: make(),
			writable: true,
			enumerable: true,
			configurable: true
		});
		else obj[key] = make();
	}
	return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
	else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					const terminal = i === fullpath.length - 1;
					if (el === "_errors") {
						if (terminal) curr._errors.push(mapper(issue));
						i++;
						continue;
					}
					if (!Object.prototype.hasOwnProperty.call(curr, el)) Object.defineProperty(curr, el, {
						value: { _errors: [] },
						enumerable: true,
						writable: true,
						configurable: true
					});
					const node = curr[el];
					if (terminal) node._errors.push(mapper(issue));
					curr = node;
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
	return {
		callee: params?.callee ?? callee,
		Err: params?.Err
	};
}
const _parse = (_Err) => {
	const fn = (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			async: false
		} : { async: false };
		const result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) throw new $ZodAsyncError();
		if (result.issues.length) {
			const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, _params?.callee ?? fn);
			throw e;
		}
		return result.value;
	};
	return fn;
};
const _parseAsync = (_Err) => {
	const fn = async (schema, value, _ctx, params) => {
		const ctx = _ctx ? {
			..._ctx,
			async: true
		} : { async: true };
		let result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) result = await result;
		if (result.issues.length) {
			const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, params?.callee ?? fn);
			throw e;
		}
		return result.value;
	};
	return fn;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? {
		success: false,
		error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? {
		success: false,
		error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
const _encode = (_Err) => {
	const parse = _parse(_Err);
	const fn = (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			direction: "backward"
		} : { direction: "backward" };
		return parse(schema, value, ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _decode = (_Err) => {
	const parse = _parse(_Err);
	const fn = (schema, value, _ctx, _params) => {
		return parse(schema, value, _ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _encodeAsync = (_Err) => {
	const parseAsync = _parseAsync(_Err);
	const fn = async (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			direction: "backward"
		} : { direction: "backward" };
		return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _decodeAsync = (_Err) => {
	const parseAsync = _parseAsync(_Err);
	const fn = async (schema, value, _ctx, _params) => {
		return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
	};
	return fn;
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
	return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
const duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
const uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^[A-Za-z0-9_-]*$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
/** Anchors a pattern source. The interpolation lives here rather than at the call site because
* esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
* will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */
function anchor(source) {
	return new RegExp(`^${source}$`);
}
const date = /*@__PURE__*/ anchor(dateSource);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
	const opts = ["Z"];
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const qualified = `${timeSource({
		precision: args.precision,
		seconds: true
	})}(?:${opts.join("|")})`;
	const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const string$1 = (params) => {
	const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
	return new RegExp(`^${regex}$`);
};
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const boolean$1 = /^(?:true|false)$/i;
const _undefined$2 = /^undefined$/i;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/checks.js
const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
/** Default `when` for length-based checks: run only on non-nullish values with a `length`. */
const _whenHasLength = (payload) => {
	const val = payload.value;
	return !nullish(val) && val.length !== void 0;
};
const numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
		if (def.value < curr) {
			if (def.inclusive) bag.maximum = def.value;
			else bag.exclusiveMaximum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin: numericOriginMap[typeof payload.value] ?? origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
		if (def.value > curr) {
			if (def.inclusive) bag.minimum = def.value;
			else bag.exclusiveMinimum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin: numericOriginMap[typeof payload.value] ?? origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		var _a;
		(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
	});
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		bag.minimum = minimum;
		bag.maximum = maximum;
		if (isInt) bag.pattern = integer;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
		if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		if ((typeof input === "string" && units > def.maximum ? codePointLength(input) : units) <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
		if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		if ((typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units) >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.minimum = def.length;
		bag.maximum = def.length;
		bag.length = def.length;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		if (def.pattern) {
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(def.pattern);
		}
	});
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
	def.pattern = pattern;
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = [], closed = {}) {
		this.content = [];
		this.indent = 0;
		this.args = args;
		this.closed = closed;
	}
	indented(fn) {
		this.indent += 1;
		fn(this);
		this.indent -= 1;
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const content = this?.content ?? [``];
		return new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {\n${content.join("\n")}\n};`)(...Object.values(this.closed));
	}
};
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/versions.js
const version = {
	major: 4,
	minor: 5,
	patch: 2
};
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/schemas.js
const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const defChecks = inst._zod.def.checks;
	const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			if (payload.memo) return payload;
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					attachSchema(payload.issues, currLen, inst);
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					attachSchema(payload.issues, currLen, inst);
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
}, {
	get "~standard"() {
		return hide(this, "~standard", standardProps(this));
	},
	set "~standard"(value) {
		own(this, "~standard", value);
	}
});
/** The Standard Schema surface for `inst`. Shared so wrappers can extend it without forcing it. */
const toStandardResult = (r) => r.success ? { value: r.data } : { issues: r.error?.issues };
function standardProps(inst) {
	return {
		validate: (value) => {
			try {
				return toStandardResult(safeParse$1(inst, value));
			} catch (_) {
				return safeParseAsync$1(inst, value).then(toStandardResult);
			}
		},
		vendor: "zod",
		version: 1
	};
}
const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
/** Parses a URL for `$ZodURL`, applying the one guard the URL constructor cannot express. Returns the parsed URL, or a code naming the stage that rejected it — the runtime needs that distinction to pick an issue note, and compiled code only needs to know it is not a URL. */
function parseURLObject(trimmed, def) {
	if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) return 1;
	try {
		return new URL(trimmed);
	} catch {
		return 2;
	}
}
const asciiTabOrNewline = /[\t\n\r]/g;
/** The URL parser deletes every ASCII tab, LF and CR from its input before it parses, so `new URL("https://exa\nmple.com")` reports on `example.com`. Applying the same deletion to the returned value closes the half of that divergence which can move the host; the parser's other rewrite, stripping C0 controls at the edges, cannot. */
function stripTabAndNewline(value) {
	return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
	hostname.lastIndex = 0;
	return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
	protocol.lastIndex = 0;
	return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			const url = parseURLObject(trimmed, def);
			if (url === 1) {
				payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid URL format",
					input: payload.value,
					inst,
					continue: !def.abort
				});
				return;
			}
			if (url === 2) {
				payload.issues.push({
					code: "invalid_format",
					format: "url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
				return;
			}
			if (def.hostname && !urlHostnameOk(url, def.hostname)) payload.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: def.hostname.source,
				input: payload.value,
				inst,
				continue: !def.abort
			});
			if (def.protocol && !urlProtocolOk(url, def.protocol)) payload.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: def.protocol.source,
				input: payload.value,
				inst,
				continue: !def.abort
			});
			payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1)) throw new Error(`Invalid nanoid length: ${def.length}`);
	def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime(def));
	$ZodStringFormat.init(inst, def);
	if (def.local || def.precision === -1) {
		inst._zod.bag.laxFormat = true;
		inst._zod.onattach.push((s) => {
			s._zod.bag.laxFormat = true;
		});
	}
});
const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date);
	$ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration);
	$ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv4`;
});
/** An IPv6 address is written with hex digits, colons and dots, and nothing else. The guard is what makes the check below an IPv6 check: `new URL("http://[...]")` parses an authority, not an address, so `@` and `\` re-delimit it and `"::@1\\"` validates against the host `0.0.0.1`. The URL parser also deletes ASCII tab, LF and CR rather than failing, which is how `"::1\n"` validated as `::1`. */
const ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
	if (!ipv6Alphabet.test(value)) return false;
	try {
		new URL(`http://[${value}]`);
		return true;
	} catch {
		return false;
	}
}
const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv6`;
	inst._zod.check = (payload) => {
		if (!isValidIPv6(payload.value)) payload.issues.push({
			code: "invalid_format",
			format: "ipv6",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
	const parts = value.split("/");
	if (parts.length !== 2) return false;
	const [address, prefix] = parts;
	if (!prefix) return false;
	const prefixNum = Number(prefix);
	if (`${prefixNum}` !== prefix) return false;
	if (prefixNum < 0 || prefixNum > 128) return false;
	return isValidIPv6(address);
}
const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (!isValidCIDRv6(payload.value)) payload.issues.push({
			code: "invalid_format",
			format: "cidrv6",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64";
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64URL(data) {
	if (!base64url.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64url);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64url";
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
const $ZodUndefined = /*@__PURE__*/ $constructor("$ZodUndefined", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = _undefined$2;
	inst._zod.values = /* @__PURE__ */ new Set([void 0]);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (typeof input === "undefined") return payload;
		payload.issues.push({
			expected: "undefined",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
		const proms = [];
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else handleArrayResult(result, payload, i);
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
function handlePropertyResult(result, final, key, input, optin, optout) {
	const isPresent = key in input;
	const isOptionalOut = optout === "optional";
	if (!isPresent && isOptionalOut && optin === "optional") return;
	if (result.issues.length) {
		if (optin !== void 0 && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && optin === void 0) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
const NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	const ownSymbols = Object.getOwnPropertySymbols(def.shape);
	const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
	const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
	for (const k of allKeys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		allKeys,
		symbolKeys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const optin = _catchall.optin;
	const optout = _catchall.optout;
	for (const key in input) {
		if (keySet.has(key)) continue;
		if (key === "__proto__") {
			if (t === "never") unrecognized.push(key);
			continue;
		}
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
		else handlePropertyResult(r, payload, key, input, optin, optout);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst,
		continue: true
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
const propShapes = /* @__PURE__ */ new WeakMap();
const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
		const sh = def.shape;
		propShapes.set(def, sh);
		Object.defineProperty(def, "shape", { get: () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			propShapes.set(def, newSh);
			return newSh;
		} });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazyInternal(inst, "propValues", (zod) => {
		const shape = zod.def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				if (!Object.prototype.hasOwnProperty.call(propValues, key)) assignProp(propValues, key, /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
				if (field.optin !== void 0) propValues[key].add(void 0);
			}
		}
		return propValues;
	});
	const isObject$1 = isObject;
	const catchall = def.catchall;
	let value;
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$1(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
		const proms = [];
		const shape = value.shape;
		for (const key of value.allKeys) {
			if (key === "__proto__") continue;
			const el = shape[key];
			const optin = el._zod.optin;
			const optout = el._zod.optout;
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
			else handlePropertyResult(r, payload, key, input, optin, optout);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
	};
});
const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const memo = globalConfig.memoizer;
	const generateFastpass = (shape) => {
		const normalized = _normalized.value;
		const syms = normalized.symbolKeys;
		const doc = new Doc(["payload", "ctx"], {
			shape,
			inst,
			memo,
			syms
		});
		const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		const prefixStr = (id, k) => `
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
          }`;
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.allKeys) ids[key] = `key_${counter++}`;
		doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
		for (const key of normalized.allKeys) {
			if (key === "__proto__") continue;
			const id = ids[key];
			const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
			const isPresent = `${k} in input`;
			const schema = shape[key];
			const optin = schema?._zod?.optin;
			const isOptionalIn = optin !== void 0;
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(k)};`);
			if (isOptionalIn && isOptionalOut) {
				const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
				doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			} else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
			else doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        
        if (${id}.value === undefined) {
          if (${isPresent}) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }

      `);
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		return doc.compile();
	};
	let fastpass;
	const isObject$2 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
	defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazyInternal(inst, "values", (zod) => {
		if (zod.def.options.every((o) => o._zod.values)) return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazyInternal(inst, "pattern", (zod) => {
		if (zod.def.options.every((o) => o._zod.pattern)) {
			const patterns = zod.def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		if (Object.prototype.hasOwnProperty.call(newObj, "__proto__")) delete newObj.__proto__;
		for (const key of sharedKeys) {
			if (key === "__proto__") continue;
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	const keyIssues = /* @__PURE__ */ new Map();
	const collect = (iss, side) => {
		let keys;
		if (iss.code === "unrecognized_keys" && !iss.path?.length) {
			unrecIssue ?? (unrecIssue = iss);
			keys = iss.keys;
		} else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
			const k = String(iss.path[0]);
			if (!keyIssues.has(k)) keyIssues.set(k, iss);
			keys = [k];
		} else return false;
		for (const k of keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k)[side] = true;
		}
		return true;
	};
	for (const iss of left.issues) if (!collect(iss, "l")) result.issues.push(iss);
	for (const iss of right.issues) if (!collect(iss, "r")) result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length) {
		const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
		if (aggregated.length) result.issues.push({
			...unrecIssue,
			keys: aggregated
		});
		for (const k of bothKeys) if (!aggregated.includes(k) && keyIssues.has(k)) result.issues.push(keyIssues.get(k));
	}
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) {
		if (aborted(result)) return result;
		throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	}
	result.value = merged.data;
	return result;
}
const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
	$ZodType.init(inst, def);
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isPlainObject(input)) {
			payload.issues.push({
				expected: "record",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		const proms = [];
		const values = def.keyType._zod.values;
		if (values && !def.partial) {
			payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
			const recordKeys = /* @__PURE__ */ new Set();
			for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
				recordKeys.add(typeof key === "number" ? key.toString() : key);
				if (key === "__proto__") continue;
				const keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (keyResult.issues.length) {
					payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				if (outKey === "__proto__") continue;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			let unrecognized;
			for (const key in input) if (!recordKeys.has(key)) {
				if (def.mode === "loose") {
					if (key === "__proto__") continue;
					payload.value[key] = input[key];
				} else {
					unrecognized = unrecognized ?? [];
					unrecognized.push(key);
				}
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized,
				continue: true
			});
		} else {
			payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
			let unrecognized;
			for (const key of Reflect.ownKeys(input)) {
				if (key === "__proto__") continue;
				if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
				let keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
					const retryResult = def.keyType._zod.run({
						value: Number(key),
						issues: []
					}, ctx);
					if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
					if (retryResult.issues.length === 0) keyResult = retryResult;
				}
				if (keyResult.issues.length) {
					if (def.mode === "loose") payload.value[key] = input[key];
					else if (values) {
						unrecognized = unrecognized ?? [];
						unrecognized.push(key);
					} else payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				if (outKey === "__proto__") continue;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized,
				continue: true
			});
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	const patternValues = values.filter((k) => propertyKeyTypes.has(typeof k));
	inst._zod.pattern = new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	const values = new Set(def.values);
	inst._zod.values = values;
	inst._zod.pattern = new RegExp(def.values.length ? `^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	globalConfig.memoizer?.guard(inst);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		return payload;
	};
});
function handleOptionalResult(payload, result) {
	payload.value = result.issues.length ? void 0 : result.value;
	return payload;
}
const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
	inst._zod.optout = "optional";
	defineLazyInternal(inst, "values", (zod) => {
		const values = zod.def.innerType._zod.values;
		return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
	});
	defineLazyInternal(inst, "pattern", (zod) => {
		const pattern = zod.def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === void 0) {
			if (def.innerType._zod.optin !== "defaulted") return payload;
			const result = def.innerType._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) return result.then((result) => handleOptionalResult(payload, result));
			return handleOptionalResult(payload, result);
		}
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
	defineLazyInternal(inst, "pattern", (zod) => {
		const pattern = zod.def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazyInternal(inst, "values", (zod) => {
		return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "defaulted";
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "defaulted";
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => {
		const v = zod.def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
function handleCatchResult(payload, result, def, ctx) {
	if (!result.issues.length) {
		payload.value = result.value;
		if (result.memo) payload.memo = true;
		return payload;
	}
	payload.value = def.catchValue({
		...result,
		value: payload.value,
		error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
		input: payload.value
	});
	return payload;
}
const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run({
			value: payload.value,
			issues: []
		}, ctx);
		if (result instanceof Promise) return result.then((result) => handleCatchResult(payload, result, def, ctx));
		return handleCatchResult(payload, result, def, ctx);
	};
});
const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
	defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
	defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues
	}, ctx);
}
const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	if (!payload.memo) payload.value = Object.freeze(payload.value);
	return payload;
}
const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/memoizer.js
var $ZodCyclicError = class extends Error {
	constructor() {
		super(`Cannot parse a reference cycle that closes through a transform`);
		this.name = "ZodCyclicError";
	}
};
/** Keyed off the context object every schema in one parse call already shares. */
const STATE = "~memo";
const NO_ISSUES = [];
function cloneIssues(issues) {
	return issues.map((iss) => iss.path ? {
		...iss,
		path: iss.path.slice()
	} : { ...iss });
}
const recursive = /*@__PURE__*/ new WeakMap();
/** Whether this schema's subtree contains a cycle, so one parse can re-enter it. */
function isRecursive(inst, stack) {
	const cached = recursive.get(inst);
	if (cached !== void 0) return cached;
	if (stack.has(inst)) return true;
	stack.add(inst);
	let result = false;
	const check = (child) => {
		if (!result && child?._zod && isRecursive(child, stack)) result = true;
	};
	const def = inst._zod.def;
	if (def.type === "lazy") check(inst._zod.innerType);
	else {
		const shape = def.shape;
		if (shape) for (const key of Reflect.ownKeys(shape)) check(shape[key]);
		for (const key in def) {
			const value = def[key];
			if (!value || typeof value !== "object") continue;
			if (value._zod) check(value);
			else if (Array.isArray(value)) for (const el of value) check(el);
		}
	}
	stack.delete(inst);
	recursive.set(inst, result);
	return result;
}
function bucketFor(state, inst) {
	let bucket = state.buckets.get(inst);
	if (!bucket) {
		bucket = /* @__PURE__ */ new Map();
		state.buckets.set(inst, bucket);
	}
	return bucket;
}
let handoff;
const open = [];
const memo = {
	alloc(_inst, payload, empty) {
		const bucket = handoff;
		if (!bucket) return empty;
		handoff = void 0;
		const entry = {
			value: empty,
			issues: null
		};
		bucket.set(payload.value, entry);
		open.push(entry);
		return empty;
	},
	guard(inst) {
		var _a;
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred.push(() => {
			const base = inst._zod.parse;
			const wrapped = (payload, ctx) => {
				if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value)) throw new $ZodCyclicError();
				return base(payload, ctx);
			};
			inst._zod.parse = wrapped;
			if (inst._zod.run === base) inst._zod.run = wrapped;
		});
	},
	attach(inst) {
		var _a;
		let isRecursiveInst;
		let lastCtx;
		let lastBucket;
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred.push(() => {
			const base = inst._zod.parse;
			const wrapped = (payload, ctx) => {
				if (isRecursiveInst === void 0) {
					isRecursiveInst = isRecursive(inst, /* @__PURE__ */ new Set());
					if (!isRecursiveInst) {
						inst._zod.parse = base;
						if (inst._zod.run === wrapped) inst._zod.run = base;
						return base(payload, ctx);
					}
				}
				const input = payload.value;
				if (input === null || typeof input !== "object") return base(payload, ctx);
				let state = ctx[STATE];
				if (!state) {
					state = {
						buckets: /* @__PURE__ */ new Map(),
						backEdges: void 0
					};
					ctx[STATE] = state;
				}
				let bucket;
				if (lastCtx === ctx) bucket = lastBucket;
				else {
					bucket = bucketFor(state, inst);
					lastCtx = ctx;
					lastBucket = bucket;
				}
				const hit = bucket.get(input);
				if (hit) {
					payload.value = hit.value;
					if (hit.issues) {
						if (hit.issues.length) payload.issues.push(...cloneIssues(hit.issues));
					} else {
						payload.memo = true;
						state.backEdges ?? (state.backEdges = /* @__PURE__ */ new Set());
						state.backEdges.add(hit.value);
					}
					return payload;
				}
				handoff = bucket;
				const depth = open.length;
				const result = base(payload, ctx);
				handoff = void 0;
				const entry = open.length > depth ? open.pop() : void 0;
				if (result instanceof Promise) return result.then((r) => {
					if (entry) entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
					return r;
				});
				if (entry) entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
				return result;
			};
			inst._zod.parse = wrapped;
			if (inst._zod.run === base) inst._zod.run = wrapped;
		});
	}
};
/** The memoizer that gives containers cycle support. `zod` installs it by default; `zod/mini` opts in with `config({ memoizer: memoizer() })`. */
function memoizer() {
	return memo;
}
/** Whether this value is a node a back-edge resolved to before it finished. */
function isBackEdge(ctx, value) {
	const backEdges = ctx[STATE]?.backEdges;
	return backEdges !== void 0 && value !== null && typeof value === "object" && backEdges.has(value);
}
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/locales/en.js
const error = () => {
	const Sizable = {
		string: {
			unit: "characters",
			verb: "to have"
		},
		file: {
			unit: "bytes",
			verb: "to have"
		},
		array: {
			unit: "items",
			verb: "to have"
		},
		set: {
			unit: "items",
			verb: "to have"
		},
		map: {
			unit: "entries",
			verb: "to have"
		}
	};
	function getSizing(origin) {
		return Sizable[origin] ?? null;
	}
	const FormatDictionary = {
		regex: "input",
		email: "email address",
		url: "URL",
		emoji: "emoji",
		uuid: "UUID",
		uuidv4: "UUIDv4",
		uuidv6: "UUIDv6",
		nanoid: "nanoid",
		guid: "GUID",
		cuid: "cuid",
		cuid2: "cuid2",
		ulid: "ULID",
		xid: "XID",
		ksuid: "KSUID",
		datetime: "ISO datetime",
		date: "ISO date",
		time: "ISO time",
		duration: "ISO duration",
		ipv4: "IPv4 address",
		ipv6: "IPv6 address",
		mac: "MAC address",
		cidrv4: "IPv4 range",
		cidrv6: "IPv6 range",
		base64: "base64-encoded string",
		base64url: "base64url-encoded string",
		json_string: "JSON string",
		e164: "E.164 number",
		credit_card: "credit card number",
		jwt: "JWT",
		template_literal: "input"
	};
	const TypeDictionary = { nan: "NaN" };
	function getTypeName(type, input) {
		if (type === "number" && typeof input === "number" && !Number.isFinite(input)) return String(input);
		return TypeDictionary[type] ?? type;
	}
	return (issue) => {
		switch (issue.code) {
			case "invalid_type": return `Invalid input: expected ${getTypeName(issue.expected)}, received ${getTypeName(parsedType(issue.input), issue.input)}`;
			case "invalid_value":
				if (issue.values.length === 1) return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
				return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
			case "too_big": {
				const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
				const sizing = getSizing(issue.origin);
				if (sizing) return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
				return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
			}
			case "too_small": {
				const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
				const sizing = getSizing(issue.origin);
				if (sizing) return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
				return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
			}
			case "invalid_format": {
				const _issue = issue;
				if (_issue.format === "starts_with") return `Invalid string: must start with "${_issue.prefix}"`;
				if (_issue.format === "ends_with") return `Invalid string: must end with "${_issue.suffix}"`;
				if (_issue.format === "includes") return `Invalid string: must include "${_issue.includes}"`;
				if (_issue.format === "regex") return `Invalid string: must match pattern ${_issue.pattern}`;
				return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
			}
			case "not_multiple_of": return `Invalid number: must be a multiple of ${issue.divisor}`;
			case "unrecognized_keys": return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
			case "invalid_key": return `Invalid key in ${issue.origin}`;
			case "invalid_union":
				if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) return `Invalid discriminator value. Expected ${issue.options.map((o) => `'${o}'`).join(" | ")}`;
				if (issue.inclusive === false) return "Invalid input: more than one option matched";
				return "Invalid input";
			case "invalid_element": return `Invalid value in ${issue.origin}`;
			default: return `Invalid input`;
		}
	};
};
function en_default() {
	return { localeError: error() };
}
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class({
		type: "string",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class({
		type: "number",
		checks: [],
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _undefined$1(Class, params) {
	return new Class({
		type: "undefined",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				if (!("input" in _issue)) _issue.input = payload.value;
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
	for (const source of sources) for (const key of Reflect.ownKeys(source)) if (Object.prototype.propertyIsEnumerable.call(source, key)) assignProp(target, key, source[key]);
	return target;
}
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		sharedDefsExtractedFor: void 0,
		sharedEmitDoneFor: void 0,
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		intersections: [],
		external: params?.external ?? void 0
	};
}
/**
* Applies the `unrepresentable` setting at a site that has no JSON Schema equivalent. Throws
* `message` unless the setting (or the handler's return value) says otherwise. Returns `true` if a
* custom JSON Schema was written into `json`, in which case the caller must not write its own.
*/
function handleUnrepresentable(schema, ctx, json, params, message) {
	const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({
		zodSchema: schema,
		path: params.path,
		message
	}) : ctx.unrepresentable;
	if (result === "any") return false;
	if (result === void 0 || result === "throw") throw new Error(message);
	Object.assign(json, result);
	return true;
}
function process(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	ctx.sharedDefsExtractedFor = void 0;
	ctx.sharedEmitDoneFor = void 0;
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			process(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) assignProps(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function encodeJSONPointerSegment(segment) {
	return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external) return;
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}`
			};
		}
		const uriPrefix = `#`;
		const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
		if (entry[1] === root && !entry[1].schema.id) return { ref: uriPrefix };
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + encodeJSONPointerSegment(defId)
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") {
				extractToDef(entry);
				continue;
			}
		}
	}
	if (ctx.external) ctx.sharedDefsExtractedFor = ctx.external;
}
/** Rewrites `anyOf: [{type: "a"}, {type: "b"}]` to `type: ["a", "b"]`, which every JSON Schema draft treats as equivalent and most consumers render far better for the nullable case. Only branches that are a bare type assertion qualify — anything carrying a constraint, `$ref`, `const` or metadata is left alone. Runs after `flattenRef`, so a branch an override decorated or `$defs` extraction turned into a `$ref` is no longer bare and correctly stays in `anyOf`. `oneOf` is excluded: `integer` and `number` overlap, so "exactly one" and "at least one" are not the same there. OpenAPI 3.0 is excluded: its `type` must be a single string. */
function compactTypeUnion(schema) {
	const options = schema.anyOf;
	if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0) return;
	const types = [];
	for (const option of options) {
		if (!option || typeof option !== "object") return;
		compactTypeUnion(option);
		const keys = Object.keys(option);
		if (keys.length !== 1 || keys[0] !== "type") return;
		const type = option.type;
		for (const member of Array.isArray(type) ? type : [type]) {
			if (typeof member !== "string") return;
			if (!types.includes(member)) types.push(member);
		}
	}
	delete schema.anyOf;
	schema.type = types.length === 1 ? types[0] : types;
}
/** Keywords `foldIntersection` knows how to combine. Anything else — `$ref`, `patternProperties`,
* an annotation like `description` — makes a member unfoldable, so a constraint this does not
* understand leaves the `allOf` alone instead of being silently dropped or misattributed. */
const FOLDABLE_KEYS = /* @__PURE__ */ new Set([
	"type",
	"properties",
	"required",
	"additionalProperties"
]);
const UNION_KEYS = ["oneOf", "anyOf"];
/** A member's constraint on a key it does not declare itself. A `catchall` states one; `false`, an absent `additionalProperties`, and the empty schema a loose object emits state nothing. */
function undeclaredConstraint(member) {
	const extra = member.additionalProperties;
	if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null) return null;
	return Object.keys(extra).length ? extra : null;
}
/** Combines object members into the single object they describe together, or returns `null` if any of them carries a keyword outside {@link FOLDABLE_KEYS}. */
function foldObjects(members) {
	const objects = [];
	for (const member of members) {
		if (typeof member !== "object" || member.type !== "object") return null;
		for (const key in member) if (!FOLDABLE_KEYS.has(key)) return null;
		objects.push(member);
	}
	const properties = {};
	const required = /* @__PURE__ */ new Set();
	for (const object of objects) {
		for (const key in object.properties) {
			if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
			const parts = [];
			for (const other of objects) {
				const part = other.properties?.[key] ?? undeclaredConstraint(other);
				if (part === null || part === void 0) continue;
				if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part))) parts.push(part);
			}
			assignProp(properties, key, parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts });
		}
		for (const key of object.required ?? []) required.add(key);
	}
	const folded = {
		type: "object",
		properties
	};
	if (required.size) folded.required = [...required];
	if (objects.every((object) => object.additionalProperties === false)) folded.additionalProperties = false;
	else {
		const constraints = [];
		for (const object of objects) {
			const constraint = undeclaredConstraint(object);
			if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint))) constraints.push(constraint);
		}
		if (constraints.length === 1) folded.additionalProperties = constraints[0];
		else if (constraints.length > 1) folded.additionalProperties = { allOf: constraints };
	}
	return folded;
}
/** `additionalProperties` in an `allOf` member sees only that member's own `properties`, so two
* closed object members reject each other's keys and the schema validates nothing. Zod's parser
* pools the key sets instead — `handleIntersectionResults` reports a key as unrecognized only when
* *every* side rejects it — so the emitted schema has to pool them too, and folding the members
* into one object is the encoding that says so on every target.
*
* This runs from `finalize`, after `extractDefs`, which is what keeps it clear of the `$ref`
* machinery: a member extracted into `$defs` is already a `$ref` by now and declines to fold, so it
* keeps its reference and its own closedness rather than being inlined as a stale copy. */
function foldIntersection(json) {
	const allOf = json.allOf;
	if (!Array.isArray(allOf) || allOf.length < 2) return;
	for (const key of FOLDABLE_KEYS) if (key in json) return;
	const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
	let folded = null;
	if (!unions.length) folded = foldObjects(allOf);
	else {
		const union = unions[0];
		const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
		if (Object.keys(union).length !== 1) return;
		const rest = allOf.filter((m) => m !== union);
		const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
		if (branches.some((b) => !b)) return;
		folded = { [keyword]: branches };
	}
	if (!folded) return;
	delete json.allOf;
	assignProps(json, folded);
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else assignProps(schema, refSchema);
			assignProps(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
		for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
		if (ctx.target !== "openapi-3.0") for (const entry of ctx.seen.entries()) compactTypeUnion(entry[1].def ?? entry[1].schema);
		if (ctx.intersections.length) {
			const carriers = /* @__PURE__ */ new Map();
			for (const seen of ctx.seen.values()) for (const json of [seen.schema, seen.def]) {
				const allOf = json?.allOf;
				if (!Array.isArray(allOf)) continue;
				const existing = carriers.get(allOf);
				if (existing) existing.push(json);
				else carriers.set(allOf, [json]);
			}
			for (const allOf of ctx.intersections) for (const json of carriers.get(allOf) ?? []) foldIntersection(json);
		}
	}
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			assignProp(defs, seen.defId, seen.def);
		}
	}
	if (ctx.external) ctx.sharedEmitDoneFor = ctx.external;
	if (ctx.external) {} else if (Object.keys(defs).length > 0) {
		if (ctx.target === "draft-2020-12") result.$defs = defs;
		else result.definitions = defs;
	}
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	process(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	process(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/core/json-schema-processors.js
const formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
const stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = schema._zod.bag;
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time" || laxFormat) delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const regexes = [...patterns];
		if (regexes.length === 1) json.pattern = regexes[0].source;
		else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
const numberProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
	if (typeof format === "string" && format.includes("int")) json.type = "integer";
	else json.type = "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) {
		if (legacy) {
			json.minimum = exclusiveMinimum;
			json.exclusiveMinimum = true;
		} else json.exclusiveMinimum = exclusiveMinimum;
	} else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) {
		if (legacy) {
			json.maximum = exclusiveMaximum;
			json.exclusiveMaximum = true;
		} else json.exclusiveMaximum = exclusiveMaximum;
	} else if (typeof maximum === "number") json.maximum = maximum;
	if (typeof multipleOf === "number") {
		if (Number.isFinite(multipleOf) && multipleOf !== 0) json.multipleOf = Math.abs(multipleOf);
		else handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${multipleOf} cannot be represented in JSON Schema`);
	}
};
const booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
const undefinedProcessor = (schema, ctx, json, params) => {
	handleUnrepresentable(schema, ctx, json, params, "Undefined cannot be represented in JSON Schema");
};
const neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
const enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.length === 0) {
		json.not = {};
		return;
	}
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
const literalProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	if (def.values.length === 0) {
		json.not = {};
		return;
	}
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema")) return;
	} else if (typeof val === "bigint") {
		if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema")) return;
		vals.push(Number(val));
	} else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
const customProcessor = (schema, ctx, json, params) => {
	handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (schema, ctx, json, params) => {
	handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = process(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
function inputOptin(schema) {
	const def = schema._zod.def;
	if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) return inputOptin(def.out);
	if (def.type === "catch") return inputOptin(def.innerType);
	return schema._zod.optin;
}
const objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const shape = def.shape;
	if (Object.getOwnPropertySymbols(shape).length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) return;
	json.type = "object";
	json.properties = {};
	for (const key in shape) assignProp(json.properties, key, process(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	}));
	const allKeys = new Set(Object.keys(shape));
	const requiredKeys = new Set([...allKeys].filter((key) => {
		const field = def.shape[key];
		if (ctx.io === "input") return inputOptin(field) === void 0;
		else return field._zod.optout === void 0;
	}));
	if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
const unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => process(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
const intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = process(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = process(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	const allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
	json.allOf = allOf;
	ctx.intersections.push(allOf);
};
const recordProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	const keyType = def.keyType;
	const patterns = keyType._zod.bag?.patterns;
	if (def.mode === "loose" && patterns && patterns.size > 0) {
		const valueSchema = process(def.valueType, ctx, {
			...params,
			path: [
				...params.path,
				"patternProperties",
				"*"
			]
		});
		json.patternProperties = {};
		for (const pattern of patterns) assignProp(json.patternProperties, pattern.source, valueSchema);
	} else {
		if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process(def.keyType, ctx, {
			...params,
			path: [...params.path, "propertyNames"]
		});
		json.additionalProperties = process(def.valueType, ctx, {
			...params,
			path: [...params.path, "additionalProperties"]
		});
	}
	const keyValues = keyType._zod.values;
	const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
	if (keyValues && !def.partial && !omittableOnInput) {
		const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
		if (validKeyValues.length > 0) json.required = validKeyValues;
	}
};
const nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
/** Round-trips a default value through JSON so the emitted schema is guaranteed to be valid JSON.
* A BigInt has no reliable encoding, so it goes through `unrepresentable` like any other
* unrepresentable value. Returns a sentinel when the caller must not write a default of its own. */
const UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
	let unrepresentable = false;
	const serialized = JSON.stringify(value, (_, val) => {
		if (typeof val !== "bigint") return val;
		unrepresentable = true;
		return null;
	});
	if (!unrepresentable) return JSON.parse(serialized);
	handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
	return UNREPRESENTABLE_DEFAULT;
}
const defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
	if (value !== UNREPRESENTABLE_DEFAULT) json.default = value;
};
const prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io !== "input") return;
	const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
	if (value !== UNREPRESENTABLE_DEFAULT) json._prefault = value;
};
const catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
		return;
	}
	json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	process(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/classic/errors.js
const _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
	Object.defineProperty(proto, key, {
		configurable: true,
		enumerable: false,
		get() {
			const value = make(this);
			Object.defineProperty(this, key, {
				value,
				configurable: true,
				writable: true
			});
			return value;
		},
		set(value) {
			Object.defineProperty(this, key, {
				value,
				configurable: true,
				writable: true
			});
		}
	});
}
const initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	const proto = Object.getPrototypeOf(inst);
	if (_installedErrorProtos.has(proto)) return;
	_installedErrorProtos.add(proto);
	_lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
	_lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
	_lazyMethod(proto, "addIssue", (self) => (issue) => {
		self.issues.push(issue);
		self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
	});
	_lazyMethod(proto, "addIssues", (self) => (issues) => {
		self.issues.push(...issues);
		self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
	});
	Object.defineProperty(proto, "isEmpty", {
		configurable: true,
		enumerable: false,
		get() {
			return this.issues.length === 0;
		}
	});
};
const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, void 0, { Parent: Error });
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/classic/parse.js
const parse = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region node_modules/.pnpm/zod@4.5.2/node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
	if (!globalConfig.localeError) config(en_default());
}
function _ensureDefaultMemoizer() {
	if (!globalConfig.memoizer) config({ memoizer: memoizer() });
}
const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	_ensureDefaultLocale();
	$ZodType.init(inst, def);
	inst.def = def;
	inst.type = def.type;
	return inst;
}, {
	check(...chks) {
		const def = this.def;
		return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
			check: ch,
			def: { check: "custom" },
			onattach: []
		} } : ch)] }), { parent: true });
	},
	with(...chks) {
		return this.check(...chks);
	},
	clone(def, params) {
		return clone(this, def, params);
	},
	brand() {
		return this;
	},
	register(reg, meta) {
		reg.add(this, meta);
		return this;
	},
	refine(check, params) {
		return this.check(refine(check, params));
	},
	superRefine(refinement, params) {
		return this.check(superRefine(refinement, params));
	},
	overwrite(fn) {
		return this.check(/* @__PURE__ */ _overwrite(fn));
	},
	optional() {
		return optional(this);
	},
	exactOptional() {
		return exactOptional(this);
	},
	nullable() {
		return nullable(this);
	},
	nullish() {
		return optional(nullable(this));
	},
	nonoptional(params) {
		return nonoptional(this, params);
	},
	array() {
		return array(this);
	},
	or(arg) {
		return union([this, arg]);
	},
	and(arg) {
		return intersection(this, arg);
	},
	transform(tx) {
		return pipe(this, transform(tx));
	},
	default(d) {
		return _default(this, d);
	},
	prefault(d) {
		return prefault(this, d);
	},
	catch(params) {
		return _catch(this, params);
	},
	pipe(target) {
		return pipe(this, target);
	},
	readonly() {
		return readonly(this);
	},
	describe(description) {
		const cl = this.clone();
		globalRegistry.add(cl, { description });
		return cl;
	},
	meta(...args) {
		if (args.length === 0) return globalRegistry.get(this);
		const cl = this.clone();
		globalRegistry.add(cl, args[0]);
		return cl;
	},
	isOptional() {
		return this.safeParse(void 0).success;
	},
	isNullable() {
		return this.safeParse(null).success;
	},
	apply(fn, ...args) {
		return args.length === 0 ? fn(this) : fn(this, ...args);
	},
	get "~standard"() {
		return hide(this, "~standard", {
			...standardProps(this),
			jsonSchema: {
				input: createStandardJSONSchemaMethod(this, "input"),
				output: createStandardJSONSchemaMethod(this, "output")
			}
		});
	},
	set "~standard"(value) {
		own(this, "~standard", value);
	},
	parse: function _parse(data, params) {
		return parse(this, data, params, { callee: _parse });
	},
	parseAsync: async function _parseAsync(data, params) {
		return await parseAsync(this, data, params, { callee: _parseAsync });
	},
	safeParse(data, params) {
		return safeParse(this, data, params);
	},
	async safeParseAsync(data, params) {
		return safeParseAsync(this, data, params);
	},
	get spa() {
		return this?.safeParseAsync;
	},
	set spa(value) {
		own(this, "spa", value);
	},
	encode: function _encode(data, params) {
		return encode(this, data, params, { callee: _encode });
	},
	decode: function _decode(data, params) {
		return decode(this, data, params, { callee: _decode });
	},
	encodeAsync: async function _encodeAsync(data, params) {
		return await encodeAsync(this, data, params, { callee: _encodeAsync });
	},
	decodeAsync: async function _decodeAsync(data, params) {
		return await decodeAsync(this, data, params, { callee: _decodeAsync });
	},
	safeEncode(data, params) {
		return safeEncode(this, data, params);
	},
	safeDecode(data, params) {
		return safeDecode(this, data, params);
	},
	async safeEncodeAsync(data, params) {
		return safeEncodeAsync(this, data, params);
	},
	async safeDecodeAsync(data, params) {
		return safeDecodeAsync(this, data, params);
	},
	toJSONSchema(params) {
		return createToJSONSchemaMethod(this, {})(params);
	},
	get description() {
		return globalRegistry.get(this)?.description;
	},
	get _def() {
		return this._zod.def;
	}
});
/** @internal */
const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.format = bag.format ?? null;
	inst.minLength = bag.minimum ?? null;
	inst.maxLength = bag.maximum ?? null;
}, {
	regex(...args) {
		return this.check(/* @__PURE__ */ _regex(...args));
	},
	includes(...args) {
		return this.check(/* @__PURE__ */ _includes(...args));
	},
	startsWith(...args) {
		return this.check(/* @__PURE__ */ _startsWith(...args));
	},
	endsWith(...args) {
		return this.check(/* @__PURE__ */ _endsWith(...args));
	},
	min(...args) {
		return this.check(/* @__PURE__ */ _minLength(...args));
	},
	max(...args) {
		return this.check(/* @__PURE__ */ _maxLength(...args));
	},
	length(...args) {
		return this.check(/* @__PURE__ */ _length(...args));
	},
	nonempty(...args) {
		return this.check(/* @__PURE__ */ _minLength(1, ...args));
	},
	lowercase(params) {
		return this.check(/* @__PURE__ */ _lowercase(params));
	},
	uppercase(params) {
		return this.check(/* @__PURE__ */ _uppercase(params));
	},
	trim() {
		return this.check(/* @__PURE__ */ _trim());
	},
	normalize(...args) {
		return this.check(/* @__PURE__ */ _normalize(...args));
	},
	toLowerCase() {
		return this.check(/* @__PURE__ */ _toLowerCase());
	},
	toUpperCase() {
		return this.check(/* @__PURE__ */ _toUpperCase());
	},
	slugify() {
		return this.check(/* @__PURE__ */ _slugify());
	}
});
const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
}, {
	email(params) {
		return this.check(/* @__PURE__ */ _email(ZodEmail, params));
	},
	url(params) {
		return this.check(/* @__PURE__ */ _url(ZodURL, params));
	},
	jwt(params) {
		return this.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	},
	emoji(params) {
		return this.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	},
	guid(params) {
		return this.check(/* @__PURE__ */ _guid(ZodGUID, params));
	},
	uuid(params) {
		return this.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	},
	uuidv4(params) {
		return this.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	},
	uuidv6(params) {
		return this.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	},
	uuidv7(params) {
		return this.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	},
	nanoid(params) {
		return this.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	},
	cuid(params) {
		return this.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	},
	cuid2(params) {
		return this.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	},
	ulid(params) {
		return this.check(/* @__PURE__ */ _ulid(ZodULID, params));
	},
	base64(params) {
		return this.check(/* @__PURE__ */ _base64(ZodBase64, params));
	},
	base64url(params) {
		return this.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	},
	xid(params) {
		return this.check(/* @__PURE__ */ _xid(ZodXID, params));
	},
	ksuid(params) {
		return this.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	},
	ipv4(params) {
		return this.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	},
	ipv6(params) {
		return this.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	},
	cidrv4(params) {
		return this.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	},
	cidrv6(params) {
		return this.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	},
	e164(params) {
		return this.check(/* @__PURE__ */ _e164(ZodE164, params));
	},
	datetime(params) {
		return this.check(/* @__PURE__ */ _isoDateTime(ZodISODateTime, params));
	},
	date(params) {
		return this.check(/* @__PURE__ */ _isoDate(ZodISODate, params));
	},
	time(params) {
		return this.check(/* @__PURE__ */ _isoTime(ZodISOTime, params));
	},
	duration(params) {
		return this.check(/* @__PURE__ */ _isoDuration(ZodISODuration, params));
	}
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
	inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
	inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
	inst.isFinite = true;
	inst.format = bag.format ?? null;
}, {
	gt(value, params) {
		return this.check(/* @__PURE__ */ _gt(value, params));
	},
	gte(value, params) {
		return this.check(/* @__PURE__ */ _gte(value, params));
	},
	min(value, params) {
		return this.check(/* @__PURE__ */ _gte(value, params));
	},
	lt(value, params) {
		return this.check(/* @__PURE__ */ _lt(value, params));
	},
	lte(value, params) {
		return this.check(/* @__PURE__ */ _lte(value, params));
	},
	max(value, params) {
		return this.check(/* @__PURE__ */ _lte(value, params));
	},
	int(params) {
		return this.check(int(params));
	},
	safe(params) {
		return this.check(int(params));
	},
	positive(params) {
		return this.check(/* @__PURE__ */ _gt(0, params));
	},
	nonnegative(params) {
		return this.check(/* @__PURE__ */ _gte(0, params));
	},
	negative(params) {
		return this.check(/* @__PURE__ */ _lt(0, params));
	},
	nonpositive(params) {
		return this.check(/* @__PURE__ */ _lte(0, params));
	},
	multipleOf(value, params) {
		return this.check(/* @__PURE__ */ _multipleOf(value, params));
	},
	step(value, params) {
		return this.check(/* @__PURE__ */ _multipleOf(value, params));
	},
	finite() {
		return this;
	}
});
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
const ZodUndefined = /*@__PURE__*/ $constructor("ZodUndefined", (inst, def) => {
	$ZodUndefined.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => undefinedProcessor(inst, ctx, json, params);
});
function _undefined(params) {
	return /* @__PURE__ */ _undefined$1(ZodUndefined, params);
}
const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
}, {
	min(n, params) {
		return this.check(/* @__PURE__ */ _minLength(n, params));
	},
	nonempty(params) {
		return this.check(/* @__PURE__ */ _minLength(1, params));
	},
	max(n, params) {
		return this.check(/* @__PURE__ */ _maxLength(n, params));
	},
	length(n, params) {
		return this.check(/* @__PURE__ */ _length(n, params));
	},
	unwrap() {
		return this.element;
	}
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
	keyof() {
		return _enum(Object.keys(this._zod.def.shape));
	},
	catchall(catchall) {
		return this.clone({
			...this._zod.def,
			catchall
		});
	},
	passthrough() {
		return this.clone({
			...this._zod.def,
			catchall: unknown()
		});
	},
	loose() {
		return this.clone({
			...this._zod.def,
			catchall: unknown()
		});
	},
	strict() {
		return this.clone({
			...this._zod.def,
			catchall: never()
		});
	},
	strip() {
		return this.clone({
			...this._zod.def,
			catchall: void 0
		});
	},
	extend(incoming) {
		return extend(this, incoming);
	},
	safeExtend(incoming) {
		return safeExtend(this, incoming);
	},
	merge(other) {
		return merge(this, other);
	},
	pick(mask) {
		return pick(this, mask);
	},
	omit(mask) {
		return omit(this, mask);
	},
	partial(...args) {
		return partial(ZodOptional, this, args[0]);
	},
	exactPartial(...args) {
		return partial(ZodExactOptional, this, args[0], "exactPartial");
	},
	required(...args) {
		return required(ZodNonOptional, this, args[0]);
	}
});
function object(shape, params) {
	const def = {
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	};
	return new ZodObject(def);
}
const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodRecord.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
	inst.keyType = def.keyType;
	inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
	if (!valueType || !valueType._zod) return new ZodRecord({
		type: "record",
		keyType: string(),
		valueType: keyType,
		...normalizeParams(valueType)
	});
	return new ZodRecord({
		type: "record",
		keyType,
		valueType,
		...normalizeParams(params)
	});
}
const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = Object.values(def.entries);
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
	return new ZodEnum({
		type: "enum",
		entries,
		...normalizeParams(params)
	});
}
const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				if (!("input" in _issue)) _issue.input = payload.value;
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			return payload;
		});
		payload.value = output;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
	});
}
const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
//#endregion
//#region src/client/remote.ts
/**
* Client-side Typert remote contribution for the `capabilityPolicy` Host
* gateway (`src/server/remote.ts`). Mirrors the generated shape that
* `@deepseek-ai/dsh-typert-generator` emits (see
* `@deepseek-ai/dsh-host-plugin-inventory/lib/typert.remote-client.js`): it
* augments `@deepseek-ai/dsh-typert-protocol` with the `capabilityPolicy`
* namespace and exports a `TYPERT_REMOTE` contribution that the browser
* plugin mounts via `ctx.remote.$mount(...)`.
*/
/** Create a strict codec for the DSH 0.2 protocol. */
function strictCodec$1(typeSymbol, schema) {
	return {
		mode: "strict",
		typeSymbol,
		create: () => schema
	};
}
const selfUpdateStatus$schema = object({
	current: string(),
	latest: string(),
	updateAvailable: boolean(),
	updatable: boolean(),
	reason: union([
		literal("local"),
		literal("non-registry"),
		literal("profile-unavailable")
	]).optional(),
	sourcePath: string().optional()
});
const capabilityDiagnostics$schema = object({
	unavailableSkills: array(object({
		name: string(),
		source: string(),
		preset: string().optional()
	})),
	shadowedSkills: array(object({
		name: string(),
		selectedFrom: string(),
		shadowedFrom: string()
	})),
	brokenPresets: array(object({
		id: string(),
		reason: string()
	})),
	unbrowseableSkills: array(object({
		name: string(),
		reason: string()
	})),
	undocumentedSkills: array(object({
		name: string(),
		summary: string()
	})),
	catalog: object({
		state: union([literal("empty"), literal("ready")]),
		count: number()
	})
});
const stringRecord$schema = record(string(), string());
const mcpLocation$schema = object({
	id: string().readonly(),
	serverName: string().readonly(),
	transport: union([literal("stdio"), literal("streamable-http")]).readonly(),
	disabled: boolean().readonly(),
	command: string().optional().readonly(),
	args: array(string()).optional().readonly(),
	env: stringRecord$schema.optional().readonly(),
	cwd: string().optional().readonly(),
	url: string().optional().readonly(),
	headers: stringRecord$schema.optional().readonly(),
	toolCallTimeoutMs: number().optional().readonly()
});
const skillLocation$schema = object({
	name: string().readonly(),
	skillName: string().optional().readonly(),
	path: string().readonly(),
	linked: boolean().readonly(),
	valid: boolean().readonly(),
	root: union([literal("user"), literal("project")]).readonly(),
	entryDir: string().readonly(),
	target: string().optional().readonly()
});
const skillUpdateStatus$schema = object({
	status: union([
		literal("current"),
		literal("available"),
		literal("modified"),
		literal("unmanaged")
	]),
	name: string(),
	entryDir: string(),
	sourceUrl: string().optional(),
	installedRevision: string().optional(),
	latestRevision: string().optional(),
	changedFiles: array(string()).optional(),
	compareUrl: string().optional(),
	gitManaged: boolean().optional()
});
const mcpInput$schema = object({
	serverName: string(),
	transport: union([literal("stdio"), literal("streamable-http")]),
	command: string().optional(),
	args: array(string()).optional(),
	env: stringRecord$schema.optional(),
	cwd: string().optional(),
	url: string().optional(),
	headers: stringRecord$schema.optional(),
	toolCallTimeoutMs: number().optional()
});
const mcpUpdateInput$schema = object({
	transport: union([literal("stdio"), literal("streamable-http")]),
	command: string().optional(),
	args: array(string()).optional(),
	env: stringRecord$schema.optional(),
	cwd: string().optional(),
	url: string().optional(),
	headers: stringRecord$schema.optional(),
	toolCallTimeoutMs: number().optional()
});
const capabilityRow$schema = object({
	id: string().readonly(),
	kind: union([literal("tool"), literal("skill")]).readonly(),
	name: string().readonly(),
	server: string().optional().readonly(),
	source: string().optional().readonly(),
	preset: string().optional().readonly(),
	path: string().optional().readonly(),
	class: union([
		literal("resident"),
		literal("on-demand"),
		literal("disabled")
	]).readonly(),
	classLabel: string().optional().readonly(),
	mandatory: boolean().readonly()
});
const skillFileEntry$schema = object({
	name: string().readonly(),
	type: union([literal("file"), literal("directory")]).readonly()
});
const catalogDocs$schema = object({
	policyYaml: string().readonly(),
	summaryMaxChars: number().readonly(),
	searchSettingsEnabled: boolean().readonly(),
	onDemand: array(object({
		id: string().readonly(),
		kind: union([literal("tool"), literal("skill")]).readonly(),
		summary: string().readonly(),
		server: string().optional().readonly()
	})).readonly()
});
const toolDetail$schema = object({
	id: string().readonly(),
	kind: union([literal("tool"), literal("skill")]).readonly(),
	actions: array(string()).readonly(),
	name: string().readonly(),
	description: string().readonly(),
	whenToUse: string().optional().readonly(),
	skillContent: string().optional().readonly(),
	parameters: record(string(), unknown()).readonly(),
	output: record(string(), unknown()).optional().readonly(),
	origin: object({
		provider: string().readonly(),
		serverName: string().optional().readonly(),
		path: string().optional().readonly(),
		source: string().optional().readonly(),
		preset: string().optional().readonly()
	}).readonly(),
	tags: array(string()).readonly(),
	stats: object({
		uses: number().readonly(),
		successes: number().readonly(),
		failures: number().readonly(),
		totalMs: number().readonly(),
		lastUsedAt: number().optional().readonly()
	}).readonly()
});
const searchMetadata$schema = object({
	id: string(),
	kind: union([literal("tool"), literal("skill")]),
	defaultDescription: string(),
	description: string().optional(),
	maxChars: number()
});
const searchMetadataUpdate$schema = object({
	id: string(),
	kind: union([literal("tool"), literal("skill")]),
	description: string()
});
const TYPERT_REMOTE = {
	package: "@daweifu/capability-menu",
	descriptors: [
		{
			id: "@daweifu/capability-menu#capabilityPolicy/checkSelfUpdate",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "checkSelfUpdate",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec$1("SelfUpdateStatus", selfUpdateStatus$schema)
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/installSelfUpdate",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "installSelfUpdate",
			invocation: { kind: "direct" },
			parameters: [{
				name: "version",
				wire: "version",
				source: "json",
				codec: strictCodec$1("string", string())
			}],
			result: strictCodec$1("void", _undefined())
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/switchSelfToNpm",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "switchSelfToNpm",
			invocation: { kind: "direct" },
			parameters: [{
				name: "version",
				wire: "version",
				source: "json",
				codec: strictCodec$1("string", string())
			}],
			result: strictCodec$1("void", _undefined())
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/getConfig",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "getConfig",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec$1("Record<string, unknown>", record(string(), unknown())),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 61,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/updateConfig",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "updateConfig",
			invocation: { kind: "direct" },
			parameters: [{
				name: "partial",
				wire: "partial",
				source: "json",
				codec: strictCodec$1("Record<string, unknown>", record(string(), unknown()))
			}],
			result: strictCodec$1("void", _undefined()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 67,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/classifyAll",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "classifyAll",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec$1("@daweifu/capability-menu#CapabilityRow", array(capabilityRow$schema)),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 73,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/getDiagnostics",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "getDiagnostics",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec$1("@daweifu/capability-menu#CapabilityDiagnostics", capabilityDiagnostics$schema),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 80,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/refresh",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "refresh",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec$1("void", _undefined()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 84,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/listSkillDir",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "listSkillDir",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "relPath",
				wire: "relPath",
				source: "json",
				acceptsUndefined: true,
				codec: strictCodec$1("string", string().optional())
			}],
			result: strictCodec$1("@daweifu/capability-menu#SkillFileEntry[]", array(skillFileEntry$schema).optional()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 85,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/readSkillFile",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "readSkillFile",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "relPath",
				wire: "relPath",
				source: "json",
				codec: strictCodec$1("string", string())
			}],
			result: strictCodec$1("string", string().optional()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 91,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/getDetail",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "getDetail",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: strictCodec$1("string", string())
			}],
			result: strictCodec$1("@daweifu/capability-menu#ToolDetail", toolDetail$schema.optional()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 79,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/getSearchMetadata",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "getSearchMetadata",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "kind",
				wire: "kind",
				source: "json",
				codec: strictCodec$1("CapabilityKind", union([literal("tool"), literal("skill")]))
			}],
			result: strictCodec$1("SearchMetadata | undefined", searchMetadata$schema.optional()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 104,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/updateSearchMetadata",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "updateSearchMetadata",
			invocation: { kind: "direct" },
			parameters: [{
				name: "input",
				wire: "input",
				source: "json",
				codec: strictCodec$1("SearchMetadataUpdate", searchMetadataUpdate$schema)
			}],
			result: strictCodec$1("void", _undefined()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 109,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/updateSummaryMaxChars",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "updateSummaryMaxChars",
			invocation: { kind: "direct" },
			parameters: [{
				name: "value",
				wire: "value",
				source: "json",
				codec: strictCodec$1("number", number())
			}],
			result: strictCodec$1("void", _undefined()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 115,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/getCatalogDocs",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "getCatalogDocs",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec$1("@daweifu/capability-menu#CatalogDocs", catalogDocs$schema),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 104,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/listLocations",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "listLocations",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec$1("@daweifu/capability-menu#McpLocation[]", array(mcpLocation$schema)),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 193,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/addLocation",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "addLocation",
			invocation: { kind: "direct" },
			parameters: [{
				name: "input",
				wire: "input",
				source: "json",
				codec: strictCodec$1("@daweifu/capability-menu#McpInput", mcpInput$schema)
			}],
			result: strictCodec$1("string", string()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 199,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/removeLocation",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "removeLocation",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: strictCodec$1("string", string())
			}],
			result: strictCodec$1("boolean", boolean()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 205,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/updateLocation",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "updateLocation",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "input",
				wire: "input",
				source: "json",
				codec: strictCodec$1("@daweifu/capability-menu#McpUpdateInput", mcpUpdateInput$schema)
			}],
			result: strictCodec$1("boolean", boolean()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 211,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/listSkillLocations",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "listSkillLocations",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec$1("@daweifu/capability-menu#SkillLocation[]", array(skillLocation$schema)),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 229,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/addSkillLocation",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "addSkillLocation",
			invocation: { kind: "direct" },
			parameters: [{
				name: "dir",
				wire: "dir",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "projectPath",
				wire: "projectPath",
				source: "json",
				acceptsUndefined: true,
				codec: strictCodec$1("string", string().optional())
			}],
			result: strictCodec$1("string", string()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 252,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/importSkillFromGitHub",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "importSkillFromGitHub",
			invocation: { kind: "direct" },
			parameters: [{
				name: "url",
				wire: "url",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "projectPath",
				wire: "projectPath",
				source: "json",
				acceptsUndefined: true,
				codec: strictCodec$1("string", string().optional())
			}],
			result: strictCodec$1("string", string()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 263,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/removeSkillLocation",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "removeSkillLocation",
			invocation: { kind: "direct" },
			parameters: [{
				name: "name",
				wire: "name",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "entryDir",
				wire: "entryDir",
				source: "json",
				acceptsUndefined: true,
				codec: strictCodec$1("string", string().optional())
			}],
			result: strictCodec$1("boolean", boolean()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 258,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/adoptSkillLocation",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "adoptSkillLocation",
			invocation: { kind: "direct" },
			parameters: [{
				name: "name",
				wire: "name",
				source: "json",
				codec: strictCodec$1("string", string())
			}],
			result: strictCodec$1("string", string()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 259,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/updateSkillLocation",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "updateSkillLocation",
			invocation: { kind: "direct" },
			parameters: [
				{
					name: "name",
					wire: "name",
					source: "json",
					codec: strictCodec$1("string", string())
				},
				{
					name: "dir",
					wire: "dir",
					source: "json",
					codec: strictCodec$1("string", string())
				},
				{
					name: "entryDir",
					wire: "entryDir",
					source: "json",
					acceptsUndefined: true,
					codec: strictCodec$1("string", string().optional())
				}
			],
			result: strictCodec$1("boolean", boolean()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 264,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/dissociateGitHubSkillSource",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "dissociateGitHubSkillSource",
			invocation: { kind: "direct" },
			parameters: [{
				name: "name",
				wire: "name",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "entryDir",
				wire: "entryDir",
				source: "json",
				acceptsUndefined: true,
				codec: strictCodec$1("string", string().optional())
			}],
			result: strictCodec$1("boolean", boolean()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 298,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/checkSkillUpdate",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "checkSkillUpdate",
			invocation: { kind: "direct" },
			parameters: [{
				name: "name",
				wire: "name",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "entryDir",
				wire: "entryDir",
				source: "json",
				acceptsUndefined: true,
				codec: strictCodec$1("string", string().optional())
			}],
			result: strictCodec$1("@daweifu/capability-menu#SkillUpdateStatus", skillUpdateStatus$schema),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 298,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/updateSkillFromGitHub",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "updateSkillFromGitHub",
			invocation: { kind: "direct" },
			parameters: [{
				name: "name",
				wire: "name",
				source: "json",
				codec: strictCodec$1("string", string())
			}, {
				name: "entryDir",
				wire: "entryDir",
				source: "json",
				acceptsUndefined: true,
				codec: strictCodec$1("string", string().optional())
			}],
			result: strictCodec$1("@daweifu/capability-menu#SkillUpdateResult", object({ revision: string() })),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 303,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/associateGitHubSkillSource",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "associateGitHubSkillSource",
			invocation: { kind: "direct" },
			parameters: [
				{
					name: "name",
					wire: "name",
					source: "json",
					codec: strictCodec$1("string", string())
				},
				{
					name: "url",
					wire: "url",
					source: "json",
					codec: strictCodec$1("string", string())
				},
				{
					name: "entryDir",
					wire: "entryDir",
					source: "json",
					acceptsUndefined: true,
					codec: strictCodec$1("string", string().optional())
				}
			],
			result: strictCodec$1("@daweifu/capability-menu#SkillUpdateStatus", skillUpdateStatus$schema),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 303,
				column: 3
			}
		},
		{
			id: "@daweifu/capability-menu#capabilityPolicy/catalogVersion",
			service: "capabilityPolicy",
			namespace: "capabilityPolicy",
			method: "catalogVersion",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec$1("number", number()),
			sourceLocation: {
				file: "src/server/remote.ts",
				line: 317,
				column: 3
			}
		}
	]
};
//#endregion
//#region src/client/guard-remote.ts
/**
* Client-side Typert remote contribution for the 执行保护 (Guard) Host gateway.
*
* This is a SECOND contribution next to the upstream `capabilityPolicy` one
* (`./remote.ts`): different package (this plugin's own name), different wire
* namespace (`thinkingGuard`), its own Host face (`src/guard-host-face.ts`).
* Both are mounted from `src/client/index.ts`, each with its own `$mount`.
*/
/** Create a strict codec for the DSH 0.2 protocol. */
function strictCodec(typeSymbol, schema) {
	return {
		mode: "strict",
		typeSymbol,
		create: () => schema
	};
}
/** Wire package id of this plugin. Must equal `GUARD_HOST_FACE_PACKAGE`. */
const GUARD_REMOTE_PACKAGE = "dsh-thinking-guard";
/** Wire namespace shared with `src/guard-host-face.ts`. */
const GUARD_REMOTE_NAMESPACE = "thinkingGuard";
const guardSwitches$schema = object({
	enabled: boolean(),
	duplicateDetection: boolean(),
	alternatingCycleDetection: boolean(),
	noProgressProtection: boolean(),
	repeatThresholds: array(number())
});
const guardSwitchesPatch$schema = object({
	enabled: boolean().optional(),
	duplicateDetection: boolean().optional(),
	alternatingCycleDetection: boolean().optional(),
	noProgressProtection: boolean().optional(),
	repeatThresholds: array(number()).optional()
});
const guardDiagnostics$schema = object({
	available: boolean(),
	reasons: array(union([literal("invalid-patch"), literal("not-mounted")])),
	persistence: object({
		dirty: boolean(),
		lastErrorCode: literal("write-failed").optional()
	})
});
const guardStats$schema = object({
	observations: number(),
	reminders: object({
		repeat: number(),
		cycle: number()
	}),
	denials: number(),
	outcomes: object({
		success: number(),
		error: number(),
		cancelled: number()
	}),
	lastReminderAt: number().optional(),
	lastDenialAt: number().optional(),
	since: number()
});
const TYPERT_GUARD_REMOTE = {
	package: GUARD_REMOTE_PACKAGE,
	descriptors: [
		{
			id: `${GUARD_REMOTE_PACKAGE}#${GUARD_REMOTE_NAMESPACE}/getGuard`,
			service: GUARD_REMOTE_NAMESPACE,
			namespace: GUARD_REMOTE_NAMESPACE,
			method: "getGuard",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec(`${GUARD_REMOTE_PACKAGE}#GuardSwitches`, guardSwitches$schema)
		},
		{
			id: `${GUARD_REMOTE_PACKAGE}#${GUARD_REMOTE_NAMESPACE}/updateGuard`,
			service: GUARD_REMOTE_NAMESPACE,
			namespace: GUARD_REMOTE_NAMESPACE,
			method: "updateGuard",
			invocation: { kind: "direct" },
			parameters: [{
				name: "change",
				wire: "change",
				source: "json",
				codec: strictCodec(`${GUARD_REMOTE_PACKAGE}#GuardSwitchesPatch`, guardSwitchesPatch$schema)
			}],
			result: strictCodec("void", _undefined())
		},
		{
			id: `${GUARD_REMOTE_PACKAGE}#${GUARD_REMOTE_NAMESPACE}/getGuardDiagnostics`,
			service: GUARD_REMOTE_NAMESPACE,
			namespace: GUARD_REMOTE_NAMESPACE,
			method: "getGuardDiagnostics",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec(`${GUARD_REMOTE_PACKAGE}#GuardDiagnostics`, guardDiagnostics$schema)
		},
		{
			id: `${GUARD_REMOTE_PACKAGE}#${GUARD_REMOTE_NAMESPACE}/getGuardStats`,
			service: GUARD_REMOTE_NAMESPACE,
			namespace: GUARD_REMOTE_NAMESPACE,
			method: "getGuardStats",
			invocation: { kind: "direct" },
			parameters: [],
			result: strictCodec(`${GUARD_REMOTE_PACKAGE}#GuardStatsSnapshot`, guardStats$schema)
		}
	]
};
//#endregion
//#region src/client/v3-ui.ts
/**
* v3 设计层（D-044）——设置页四个子页面共用的 token、容器脚手架与块级词汇表。
*
* WHY A SHARED MODULE: v3 的视觉识别来自一套统一的 token 与块（panel / stats /
* board / rank / table / gitem / catstat）。四个页面各写一份必然漂移，所以跨页面
* 复用的部分集中在这里；页面专属样式仍留在各自文件里（调用统计页的样式函数、
* CapabilitySection.tsx 的 mc-* 样式块）。
*
* CONTAINER, NOT VIEWPORT: 设置面板是宿主写死的 800px 弹窗，内容列只有 564px，
* 与视口宽度无关（D-044 实测）。因此 v3 的断点全部写成 `@container v3`，页面根
* 节点加上 `v3-root` 即成为容器。用 `@media` 会在 1200px 窗口里误判成「宽」，
* 画出实际放不下的双栏。
*
* THEME: v3 原始 CSS 写死深色；这里全部映射到宿主 `--dsw-alias-*`，深浅色跟随
* 应用。卡片底色用「label-primary 的 4% 叠在 bg-layer-2 上」而不是半透明白，
* 否则浅色主题下会发脏。
*
* 本模块只输出样式与一个 style 元素，不假设任何 DOM 结构。
*/
/** Every rule the v3 pages share. Class names are global like the existing mc-*. */
const CSS$2 = [
	".v3-root{container:v3 / inline-size;--v3-bg:var(--dsw-alias-bg-layer-2,Canvas);--v3-panel:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 4%,var(--dsw-alias-bg-layer-2,Canvas));--v3-panel-2:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 8%,var(--dsw-alias-bg-layer-2,Canvas));--v3-line:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 10%,transparent);--v3-line-2:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 17%,transparent);--v3-t1:var(--dsw-alias-label-primary,CanvasText);--v3-t2:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary,CanvasText));--v3-t3:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,CanvasText));--v3-t4:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,CanvasText));--v3-ok:var(--dsw-alias-state-success-primary,#18894a);--v3-bad:var(--dsw-alias-state-error-primary,#c92b2b);--v3-warn:var(--dsw-alias-state-warn-primary,#a2730a);--v3-info:var(--dsw-alias-link,var(--dsw-alias-brand-primary,#2066c4));--v3-ok-dim:color-mix(in srgb,var(--v3-ok) 16%,transparent);--v3-bad-dim:color-mix(in srgb,var(--v3-bad) 14%,transparent);--v3-warn-dim:color-mix(in srgb,var(--v3-warn) 14%,transparent);--v3-info-dim:color-mix(in srgb,var(--v3-info) 14%,transparent);--v3-r-sm:var(--dsw-radius-sm,6px);--v3-r-md:var(--dsw-radius-md,9px);--v3-r-lg:var(--dsw-radius-lg,12px);--v3-font-code:var(--dsw-font-markdown-code-font-family,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);color:var(--v3-t1);font-size:13px;line-height:20px}",
	".v3-num{font-variant-numeric:tabular-nums}",
	".v3-mono{font-family:var(--v3-font-code)}",
	".v3-statusline{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--v3-t3);padding:5px 10px;border-radius:999px;background:var(--v3-panel);border:1px solid var(--v3-line);min-width:0}",
	".v3-statusline b{color:var(--v3-t1);font-weight:600}",
	".v3-statusline[data-tone='bad']{background:var(--v3-bad-dim);border-color:color-mix(in srgb,var(--v3-bad) 30%,transparent)}",
	".v3-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none;background:var(--v3-t4)}",
	".v3-dot[data-tone='ok']{background:var(--v3-ok);box-shadow:0 0 0 3px var(--v3-ok-dim)}",
	".v3-dot[data-tone='bad']{background:var(--v3-bad);box-shadow:0 0 0 3px var(--v3-bad-dim)}",
	".v3-dot[data-tone='warn']{background:var(--v3-warn);box-shadow:0 0 0 3px var(--v3-warn-dim)}",
	".v3-dot[data-tone='run']{width:8px;height:8px;background:transparent;border:1.5px solid var(--v3-t3);border-top-color:transparent;animation:v3-spin .9s linear infinite;box-shadow:none}",
	"@keyframes v3-spin{to{transform:rotate(360deg)}}",
	".v3-panel{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);padding:13px 15px;min-width:0}",
	".v3-ph{display:flex;align-items:center;gap:8px;margin-bottom:11px;min-height:18px;flex-wrap:wrap}",
	".v3-pt{margin:0;font-size:11px;font-weight:600;color:var(--v3-t3);letter-spacing:.07em;text-transform:uppercase}",
	".v3-pn{margin-left:auto;font-size:11px;color:var(--v3-t4);white-space:nowrap;text-transform:none;letter-spacing:0}",
	".v3-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--v3-line);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);overflow:hidden}",
	".v3-stat{background:var(--v3-panel);padding:13px 15px;min-width:0}",
	".v3-stat-l{font-size:11px;color:var(--v3-t3);letter-spacing:.02em}",
	".v3-stat-v{font-size:26px;line-height:34px;font-weight:650;letter-spacing:-.025em;margin-top:3px;font-variant-numeric:tabular-nums}",
	".v3-stat-v small{font-size:12px;font-weight:400;color:var(--v3-t3);margin-left:4px;letter-spacing:0}",
	".v3-stat-d{font-size:11px;color:var(--v3-t4);margin-top:2px;display:flex;align-items:center;gap:5px}",
	".v3-spark{margin-top:8px;display:block;width:100%;height:22px;overflow:visible}",
	".v3-spark .v3-spark-ln{fill:none;stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round}",
	".v3-spark .v3-spark-fl{opacity:.14}",
	".v3-board{display:grid;grid-template-columns:minmax(0,2.15fr) minmax(0,1fr);gap:12px;align-items:stretch}",
	".v3-chartbox{position:relative;min-width:0}",
	".v3-chart{display:block;width:100%;height:212px;overflow:visible}",
	".v3-chart .v3-grid{stroke:var(--v3-line);stroke-width:1}",
	".v3-chart .v3-axis{fill:var(--v3-t4);font-size:9.5px}",
	".v3-chart .v3-area{fill:var(--v3-info);opacity:.13}",
	".v3-chart .v3-line{fill:none;stroke:var(--v3-info);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}",
	".v3-chart .v3-pt{fill:var(--v3-panel);stroke:var(--v3-info);stroke-width:1.6}",
	".v3-chart .v3-bar-er{fill:var(--v3-bad);opacity:.85}",
	".v3-chart .v3-hlbox{fill:var(--v3-info-dim);stroke:var(--v3-info);stroke-width:1;stroke-dasharray:3 3}",
	".v3-chart .v3-lbl{fill:var(--v3-t2);font-size:10px}",
	".v3-chart .v3-lbl-b{fill:var(--v3-t1);font-size:10.5px;font-weight:600}",
	".v3-legend{display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--v3-t4);flex-wrap:wrap}",
	".v3-legend span{display:inline-flex;align-items:center;gap:6px}",
	".v3-legend i{width:14px;height:2px;border-radius:1px;flex:none;background:var(--v3-info)}",
	".v3-legend i[data-mark='square']{width:8px;height:8px;border-radius:2px;background:var(--v3-bad)}",
	".v3-donut-wrap{display:flex;align-items:center;gap:14px;flex-wrap:wrap}",
	".v3-donut{flex:none;width:104px;height:104px;position:relative}",
	".v3-donut svg{width:104px;height:104px;transform:rotate(-90deg)}",
	".v3-donut .v3-trk{fill:none;stroke:var(--v3-panel-2);stroke-width:9}",
	".v3-donut .v3-seg{fill:none;stroke:var(--v3-t4);stroke-width:9}",
	".v3-donut .v3-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}",
	".v3-donut .v3-mid b{font-size:17px;font-weight:650;letter-spacing:-.02em;line-height:20px}",
	".v3-donut .v3-mid span{font-size:9.5px;color:var(--v3-t4);line-height:12px;letter-spacing:.04em}",
	".v3-src-list{flex:1 1 180px;min-width:0;display:flex;flex-direction:column;gap:5px}",
	".v3-src{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--v3-t2);min-width:0}",
	".v3-src i{width:7px;height:7px;border-radius:2px;flex:none;background:var(--v3-t4);opacity:.5}",
	".v3-src .v3-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
	".v3-src b{margin-left:auto;color:var(--v3-t1);font-weight:600;font-variant-numeric:tabular-nums}",
	".v3-src em{font-style:normal;color:var(--v3-t4);min-width:44px;text-align:right;font-variant-numeric:tabular-nums;font-size:11px}",
	".v3-src-note{margin:9px 0 0;padding-top:9px;border-top:1px solid var(--v3-line);font-size:11px;line-height:17px;color:var(--v3-t4)}",
	".v3-rank{display:flex;flex-direction:column;gap:1px;margin-top:-2px}",
	".v3-rank-row{display:flex;align-items:center;gap:9px;min-height:27px;font-size:12px;padding:0 2px;border-radius:4px}",
	".v3-rank-row:hover{background:var(--v3-panel-2)}",
	".v3-rank-row .v3-nm{font-family:var(--v3-font-code);font-size:11.5px;color:var(--v3-t2);width:158px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
	".v3-rank-row .v3-bar{flex:1 1 auto;min-width:30px;height:6px;background:var(--v3-panel-2);border-radius:3px;position:relative;overflow:hidden}",
	".v3-rank-row .v3-bar span{position:absolute;left:0;top:0;bottom:0;min-width:3px;background:var(--v3-info);opacity:.65;border-radius:3px}",
	".v3-rank-row .v3-bar span[data-bad='true']{background:var(--v3-bad);opacity:.85}",
	".v3-rank-row .v3-n{width:52px;flex:none;text-align:right;font-variant-numeric:tabular-nums;color:var(--v3-t2);white-space:nowrap}",
	".v3-rank-row .v3-e{flex:none;text-align:right;font-variant-numeric:tabular-nums;font-size:11px;color:var(--v3-t4);white-space:nowrap}",
	".v3-rank-row .v3-e[data-bad='true']{color:var(--v3-bad);font-weight:600}",
	".v3-ts{max-height:min(60vh,560px);overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--v3-line)}",
	".v3-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}",
	".v3-table thead th{position:sticky;top:0;z-index:2;background:var(--v3-panel);color:var(--v3-t4);font-weight:500;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;text-align:left;padding:0 11px;height:29px;white-space:nowrap;border-bottom:1px solid var(--v3-line)}",
	".v3-table thead th.v3-r{text-align:right}",
	".v3-table tbody td{padding:0 11px;height:32px;border-bottom:1px solid var(--v3-line);vertical-align:middle;white-space:nowrap}",
	".v3-table tbody tr:last-child td{border-bottom:0}",
	".v3-table tbody tr:hover td{background:var(--v3-panel-2)}",
	".v3-table td.v3-r{text-align:right;font-variant-numeric:tabular-nums;color:var(--v3-t2)}",
	".v3-c-tool{display:flex;align-items:center;gap:7px;min-width:0}",
	".v3-c-tool .v3-nm{font-family:var(--v3-font-code);font-size:11.5px;overflow:hidden;text-overflow:ellipsis}",
	".v3-c-tool .v3-srv{font-size:10.5px;color:var(--v3-t4)}",
	".v3-srcnote{flex:none;font-size:9px;line-height:13px;height:13px;padding:0 4px;border-radius:3px;color:var(--v3-t4);background:var(--v3-panel-2)}",
	".v3-rt{display:inline-flex;align-items:center;gap:7px;justify-content:flex-end}",
	".v3-rt .v3-tk{width:34px;height:3px;border-radius:2px;background:var(--v3-panel-2);overflow:hidden;flex:none}",
	".v3-rt .v3-fl{display:block;height:100%;background:var(--v3-ok);border-radius:2px}",
	".v3-rt .v3-fl[data-bad='true']{background:var(--v3-bad)}",
	".v3-rt b{font-weight:500;min-width:40px;text-align:right;font-variant-numeric:tabular-nums}",
	".v3-tfoot{display:flex;align-items:center;gap:9px;padding:9px 15px;border-top:1px solid var(--v3-line);color:var(--v3-t4);font-size:11px;flex-wrap:wrap}",
	".v3-empty{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);padding:34px 24px;text-align:center}",
	".v3-empty h3{margin:0 0 5px;font-size:14px;font-weight:600;color:var(--v3-t1)}",
	".v3-empty p{margin:0 auto;max-width:56ch;font-size:12.5px;line-height:20px;color:var(--v3-t3)}",
	".v3-banner{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border-radius:var(--v3-r-md);background:var(--v3-bad-dim);border:1px solid color-mix(in srgb,var(--v3-bad) 32%,transparent);font-size:12px;line-height:19px;color:var(--v3-t2)}",
	".v3-banner b{display:block;font-size:12.5px;margin-bottom:2px;color:var(--v3-t1)}",
	".v3-banner code{font-family:var(--v3-font-code);font-size:10.5px;padding:1px 5px;border-radius:3px;background:var(--v3-panel-2);color:var(--v3-t3);margin-left:5px}",
	".v3-faultcard{background:var(--v3-panel);border:1px solid var(--v3-line);border-left:3px solid var(--v3-bad);border-radius:var(--v3-r-md);overflow:hidden}",
	".v3-faultcard .v3-fh{display:flex;align-items:center;gap:8px;padding:9px 13px}",
	".v3-faultcard .v3-fh b{font-size:12.5px;font-weight:600}",
	".v3-faultcard .v3-fh code{font-family:var(--v3-font-code);font-size:10.5px;padding:1px 5px;border-radius:3px;background:var(--v3-panel-2);color:var(--v3-t3)}",
	".v3-faultcard p{margin:0;padding:0 13px 9px;font-size:11.5px;line-height:18px;color:var(--v3-t3)}",
	".v3-gpanel{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}",
	".v3-gitem{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);padding:13px 15px;min-width:0}",
	".v3-gitem .v3-gh{display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap}",
	".v3-gitem .v3-gnm{font-size:13px;font-weight:600}",
	".v3-gitem .v3-gid{font-family:var(--v3-font-code);font-size:10.5px;color:var(--v3-t4)}",
	".v3-gitem p{margin:0;font-size:11.5px;line-height:18px;color:var(--v3-t3)}",
	".v3-gitem .v3-gfoot{display:flex;align-items:center;gap:6px;margin-top:9px;font-size:10.5px;color:var(--v3-t4);padding-top:9px;border-top:1px solid var(--v3-line);flex-wrap:wrap}",
	".v3-kbd{font-family:var(--v3-font-code);font-size:10.5px;padding:1px 5px;border-radius:3px;background:var(--v3-panel-2);color:var(--v3-t2);border:1px solid var(--v3-line)}",
	".v3-notebox{margin:0;padding:11px 13px;border-radius:var(--v3-r-md);background:var(--v3-panel);border:1px solid var(--v3-line);color:var(--v3-t3);font-size:11.5px;line-height:18px}",
	".v3-notebox b{color:var(--v3-t2);font-weight:600}",
	".v3-sw{position:relative;width:34px;height:19px;border:0;border-radius:999px;padding:0;cursor:pointer;flex:none;background:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 16%,transparent);transition:background .16s}",
	".v3-sw::after{content:'';position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:var(--dsw-alias-switch-thumb,var(--v3-bg));transition:transform .16s}",
	".v3-sw[aria-checked='true']{background:var(--v3-ok)}",
	".v3-sw[aria-checked='true']::after{transform:translateX(15px)}",
	".v3-sw:disabled{opacity:.55;cursor:default}",
	".v3-sw:focus-visible{outline:2px solid var(--v3-info);outline-offset:2px}",
	".v3-catgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}",
	".v3-catstat{display:flex;background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);overflow:hidden;margin-bottom:12px}",
	".v3-catstat>div{flex:1 1 0;padding:11px 14px;min-width:0}",
	".v3-catstat>div+div{border-left:1px solid var(--v3-line)}",
	".v3-catstat .v3-l{font-size:10.5px;color:var(--v3-t4);letter-spacing:.05em;text-transform:uppercase}",
	".v3-catstat .v3-v{font-size:19px;font-weight:650;margin-top:2px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}",
	".v3-catstat .v3-v small{font-size:11px;font-weight:400;color:var(--v3-t3);margin-left:4px;letter-spacing:0}",
	".v3-group{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-md);overflow:hidden;margin-bottom:10px;min-width:0}",
	".v3-group:last-child{margin-bottom:0}",
	".v3-group>summary{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;list-style:none;min-height:36px;flex-wrap:wrap}",
	".v3-group>summary::-webkit-details-marker{display:none}",
	".v3-group>summary:hover{background:var(--v3-panel-2)}",
	".v3-group[open]>summary{border-bottom:1px solid var(--v3-line)}",
	".v3-group>summary .v3-chev{width:10px;height:10px;color:var(--v3-t4);flex:none;transition:transform .14s}",
	".v3-group[open]>summary .v3-chev{transform:rotate(90deg)}",
	".v3-group>summary .v3-gnm{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
	".v3-group>summary .v3-cnt{font-size:10.5px;color:var(--v3-t4);flex:none}",
	".v3-group>summary .v3-right{margin-left:auto;display:flex;gap:4px;align-items:center;flex:none}",
	".v3-trow{display:flex;align-items:center;gap:8px;padding:0 12px 0 29px;min-height:30px;border-top:1px solid var(--v3-line);font-size:12px;min-width:0}",
	".v3-trow:first-of-type{border-top:0}",
	".v3-trow:hover{background:var(--v3-panel-2)}",
	".v3-trow .v3-nm{font-family:var(--v3-font-code);font-size:11.5px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
	".v3-trow .v3-uses{flex:none;font-size:11px;color:var(--v3-t4);font-variant-numeric:tabular-nums;white-space:nowrap}",
	".v3-tag{display:inline-flex;align-items:center;gap:4px;height:17px;padding:0 6px;border-radius:4px;font-size:10px;line-height:17px;white-space:nowrap;color:var(--v3-t3);background:var(--v3-panel-2)}",
	".v3-tag[data-tone='info']{color:var(--v3-info);background:var(--v3-info-dim)}",
	".v3-tag[data-tone='warn']{color:var(--v3-warn);background:var(--v3-warn-dim)}",
	".v3-tag[data-tone='bad']{color:var(--v3-bad);background:var(--v3-bad-dim)}",
	".v3-hint{margin:0;font-size:11px;line-height:17px;color:var(--v3-t4)}",
	".v3-scopehint{display:flex;align-items:center;gap:7px;margin-top:9px;padding:6px 10px;border-radius:var(--v3-r-sm);background:var(--v3-panel-2);font-size:11.5px;line-height:17px;color:var(--v3-t3);flex-wrap:wrap}",
	".v3-scopehint .v3-id{font-family:var(--v3-font-code);font-size:11px;color:var(--v3-t2);padding:1px 5px;border-radius:3px;background:var(--v3-panel);border:1px solid var(--v3-line)}",
	".v3-scopehint[data-tone='warn']{background:var(--v3-warn-dim);color:var(--v3-t2)}",
	".v3-scan{display:flex;align-items:center;gap:10px;margin-top:9px;font-size:11.5px;color:var(--v3-t3)}",
	".v3-scan .v3-track{position:relative;flex:1 1 auto;height:5px;border-radius:3px;background:var(--v3-panel-2);overflow:hidden;min-width:70px}",
	".v3-scan .v3-fill{position:absolute;inset:0 auto 0 0;background:var(--v3-info);border-radius:3px;transition:width .3s ease}",
	".v3-scan[data-running='true'] .v3-fill{width:34% !important;animation:v3-indet 1.25s ease-in-out infinite}",
	"@keyframes v3-indet{0%{left:-34%}100%{left:100%}}",
	".v3-scan .v3-pct{font-variant-numeric:tabular-nums;color:var(--v3-t2);font-weight:600;min-width:38px;text-align:right}",
	"@container v3 (max-width:980px){.v3-board{grid-template-columns:minmax(0,1fr)}}",
	"@container v3 (max-width:900px){.v3-gpanel,.v3-catgrid{grid-template-columns:minmax(0,1fr)}}",
	"@container v3 (max-width:720px){.v3-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.v3-catstat{flex-wrap:wrap}.v3-catstat>div{flex:1 1 45%}.v3-catstat>div+div{border-left:0}}",
	"@container v3 (max-width:620px){.v3-rank-row .v3-nm{width:104px}}",
	"@media (prefers-reduced-motion:reduce){.v3-dot[data-tone='run'],.v3-scan[data-running='true'] .v3-fill{animation:none}}",
	"[hidden]{display:none !important}"
].join("");
/**
* Mount the shared v3 stylesheet once per document.
*
* React does not dedupe <style> elements across the four pages, and all four
* render their own root, so the element carries a marker attribute and an
* identical copy in the DOM is harmless. Kept as an element (not a singleton
* side effect at import time) so the hook-free views stay pure and the test
* suite can still walk the tree.
*/
function V3Styles() {
	return (0, react.createElement)("style", { "data-v3-style": "true" }, CSS$2);
}
//#endregion
//#region src/client/GuardPanel.tsx
/**
* 执行保护 — the Guard configuration surface (v3 · 数据看板, D-044).
*
* 移植说明：本文件从旧插件（四页签外壳）的 GuardPanel.tsx 移植，唯一契约变化是
* 文案键类型。旧版依赖 `PluginSection.tsx` 的 `PluginSectionKey`（那是一个四页签
* 外壳的联合类型），本插件没有外壳，所以这里自带一个只含本面板真正用到的键的
* `GuardPanelKey`，并把 t() 收紧成 `(key: GuardPanelKey) => string`。DOM 契约原样保留。
*
* Three sections, in product order: repeated identical calls, alternating
* cycles, no-progress protection. Each carries a model-side identifier
* ('duplicate_call' / 'alternating_cycle' / 'no_progress') shown as plain text,
* because the reminder injected into the conversation is English while the label
* a user reads here is Chinese. The identifier ties the two together.
*
* v3 SHAPE: a two-column grid of .v3-gitem cards (>900px two columns, auto single
* column via the container query in v3-ui.ts). The Guard counters sit at the very
* top as a four-cell .v3-stats strip, followed by one short boundary hint. No page
* title, no "activity" sub-title, no "counting since" line — the tab already says
* what this page is.
*
* DOM CONTRACT kept: nine <li class="mc-guard-point"> whose text still comes from
* t(); the three data-guard-section values in order; the threshold editor wrapped
* in data-guard-thresholds (three number inputs, values from the Host); the four
* data-guard-stat cells and data-guard-stats; and three role="switch" buttons
* whose aria-checked follows the props. No Chinese colon ('：') is introduced by
* this file — spacing does the separating instead.
*
* Hook-free and prop-driven EXCEPT the threshold editor, which owns a real draft
* (`useGuardThresholdDraft`): typing only moves local state, and a commit —
* Enter, blur or the explicit 保存 button — sends the whole list only when it is
* a complete valid ascending 2..50 array. That component is tagged with
* `HOOK_COMPONENT` so element-tree walkers skip exactly it instead of calling it
* outside a render.
*/
/**
* Section id → localized title plus the lines that explain what the switch does.
*
* The descriptions are part of the contract, not decoration: a bare switch does
* not tell a reader whether turning it off stops reminders only or also stops
* local denials. Each bullet states the real behaviour the detector implements.
*
* v3 keeps all three bullets (nine <li class="mc-guard-point"> in total) but lays
* them out as one compact wrapped row per card.
*/
const SECTIONS = [
	{
		id: "duplicate_call",
		titleKey: "guardSectionA",
		bodyKeys: [
			"guardABody1",
			"guardABody2",
			"guardABody3"
		]
	},
	{
		id: "alternating_cycle",
		titleKey: "guardSectionB",
		bodyKeys: [
			"guardBBody1",
			"guardBBody2",
			"guardBBody3"
		]
	},
	{
		id: "no_progress",
		titleKey: "guardSectionC",
		bodyKeys: [
			"guardCBody1",
			"guardCBody2",
			"guardCBody3"
		]
	}
];
/**
* Page-specific rules for the v3 Guard grid. Everything else comes from
* v3-ui.ts; the only local vocabulary here is the compact bullet row, the
* threshold editor chrome and the per-card "fired" foot. Colours are always v3
* semantic variables — nothing is hard-coded, so light and dark themes both
* track the host.
*/
const GUARD_CSS = [
	".mc-section.v3-root{display:flex;flex-direction:column;gap:12px}",
	".v3-gpoints{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:0 5px}",
	".v3-gpoints>.mc-guard-point{font-size:11.5px;line-height:18px;color:var(--v3-t3)}",
	".v3-gpoints>.mc-guard-point+.mc-guard-point::before{content:'·';margin-right:5px;color:var(--v3-t4)}",
	".v3-gitem--info{background:var(--v3-panel-2)}",
	".v3-gitem .v3-gh .v3-sw{margin-left:auto}",
	".v3-gfoot-edit{margin-top:9px}",
	".v3-guard-stats{margin:0}",
	".v3-gfoot-note{color:var(--v3-t4)}",
	".mc-guard-threshold-edit{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
	".mc-guard-threshold-body{display:contents}",
	".mc-guard-threshold-edit-label{font-size:11.5px;color:var(--v3-t3)}",
	".mc-guard-threshold-num{width:56px;padding:3px 6px;border-radius:var(--v3-r-sm);font-size:12px;text-align:center;font-family:var(--v3-font-code);color:var(--v3-t1);background:var(--v3-panel-2);border:1px solid var(--v3-line)}",
	".mc-guard-threshold-num:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}",
	".mc-guard-threshold-num:disabled{opacity:.6}",
	".mc-guard-threshold-hint{margin:6px 0 0}",
	".mc-guard-threshold-save{padding:3px 10px;border-radius:var(--v3-r-sm);font-size:11.5px;color:var(--v3-t1);background:var(--v3-panel-2);border:1px solid var(--v3-line);cursor:pointer}",
	".mc-guard-threshold-save:disabled{opacity:.5;cursor:default}",
	".mc-guard-threshold-save:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}",
	".mc-guard-threshold-hint[data-guard-threshold-invalid='true']{color:var(--v3-bad)}"
].join("");
/** Strictly ascending, 1..5 entries, each an integer in 2..50. */
function isGuardThresholdListValid(list) {
	if (list.length === 0 || list.length > 5) return false;
	let previous = 1;
	for (const value of list) {
		if (!Number.isInteger(value) || value < 2 || value > 50) return false;
		if (value <= previous) return false;
		previous = value;
	}
	return true;
}
/** Parse the raw boxes into a committable list, or undefined when not valid yet. */
function parseThresholdDraft(rows) {
	if (rows.length === 0 || rows.length > 5) return void 0;
	const parsed = [];
	for (const row of rows) {
		const text = row.trim();
		if (!/^\d+$/.test(text)) return void 0;
		const value = Number(text);
		if (!Number.isSafeInteger(value)) return void 0;
		parsed.push(value);
	}
	return isGuardThresholdListValid(parsed) ? parsed : void 0;
}
/** Cheap, unambiguous equality key for a row list. */
function rowsKey(rows) {
	return rows.join("\0");
}
/**
* Marks a component whose body calls hooks.
*
* A walker that expands function components by CALLING them is valid for a
* hook-free view and fatal for one with hooks — React throws "Invalid hook call"
* outside a render. Such a component carries this symbol so a walker skips
* exactly it and keeps expanding every other component.
*/
const HOOK_COMPONENT = Symbol.for("dsh-thinking-guard.hook-component");
/**
* The draft state behind the threshold editor.
*
* Typing NEVER writes. A keystroke only moves the draft, so '' (a cleared box)
* and '2' on the way to '20' survive as ordinary intermediate states instead of
* being rejected or, worse, sent as a half-edited list. A commit — Enter, blur,
* or the explicit 保存 button — hands over the WHOLE list and only when it is a
* complete, valid, strictly ascending 2..50 array.
*
* Sync rules, spelled out because they are the part that silently rots:
*  - external (Host) value changed → the draft is reset to it and `dirty`
*    clears, UNLESS the draft is dirty and the Host's value is unchanged from
*    the last one this editor saw (a poll re-delivering the same list must not
*    wipe what the operator is typing);
*  - dirty is a pure comparison with the Host list, so an edit that returns the
*    text to the committed values stops being dirty;
*  - a rejected submit keeps the draft, so the operator can fix it instead of
*    retyping; the draft only stops being dirty when the Host actually adopts it;
*  - `onChange` omitted (Host rejects writes, or the page is busy) ⇒ read-only;
*    the draft is KEPT across that window rather than reset to the Host's values.
*/
function useGuardThresholdDraft(props) {
	const { thresholds, onChange } = props;
	const editable = thresholds !== void 0 && onChange !== void 0;
	const committed = thresholds === void 0 ? [] : thresholds.map((value) => String(value));
	const [rows, setRows] = (0, react.useState)(committed);
	const [conflict, setConflict] = (0, react.useState)(false);
	/** The Host list this draft was last synchronized against. */
	const synced = (0, react.useRef)(committed);
	const draftRef = (0, react.useRef)(committed);
	draftRef.current = rows;
	(0, react.useEffect)(() => {
		const nextKey = rowsKey(committed);
		const syncedKey = rowsKey(synced.current);
		if (nextKey === syncedKey) return;
		synced.current = committed;
		const draftKey = rowsKey(draftRef.current);
		if (draftKey === syncedKey || draftKey === nextKey) {
			draftRef.current = committed;
			setRows(committed);
			setConflict(false);
			return;
		}
		setConflict(true);
	}, [rowsKey(committed)]);
	const dirty = rowsKey(rows) !== rowsKey(committed);
	const parsed = parseThresholdDraft(rows);
	return {
		rows,
		dirty,
		invalid: dirty && parsed === void 0,
		conflict,
		editable,
		setRow: (0, react.useCallback)((index, text) => {
			if (!editable) return;
			setRows((current) => {
				const next = current.slice();
				next[index] = text;
				return next;
			});
		}, [editable]),
		commit: (0, react.useCallback)(() => {
			if (!editable) return false;
			const current = draftRef.current;
			const list = parseThresholdDraft(current);
			if (list === void 0) return false;
			if (rowsKey(current) === rowsKey(committed)) return false;
			onChange(list);
			return true;
		}, [
			editable,
			onChange,
			rowsKey(committed)
		])
	};
}
/**
* Editable reminder thresholds — the independent draft editor.
*
* Three plain number inputs instead of one comma-separated text field: the
* operator sees one box per firing point and never has to learn a syntax. This
* component owns ONLY the draft; it renders it and forwards intents. The Host's
* values are the props, so the page above stays a pure view.
*
* data-guard-thresholds marks the wrapper (owned by the hook-free view); a Host
* that rejects writes gets disabled boxes.
*/
function GuardThresholdEditor(props) {
	const { t, thresholds } = props;
	const draft = useGuardThresholdDraft(props);
	if (thresholds === void 0) return null;
	const { editable, rows, invalid } = draft;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "mc-guard-threshold-body",
		"data-guard-threshold-conflict": draft.conflict ? "true" : "false",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
				className: "mc-guard-threshold-edit-label",
				children: t("guardThresholds")
			}),
			rows.map((text, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				type: "number",
				min: 2,
				max: 50,
				step: 1,
				className: "mc-guard-threshold-num",
				value: text,
				readOnly: !editable,
				disabled: !editable,
				"aria-label": t("guardThresholds") + " " + String(index + 1),
				"aria-invalid": invalid ? "true" : "false",
				"data-guard-threshold-dirty": draft.dirty ? "true" : "false",
				onChange: (event) => {
					draft.setRow(index, event.target.value);
				},
				onKeyDown: (event) => {
					if (!editable || event.key !== "Enter") return;
					event.preventDefault();
					draft.commit();
				},
				onBlur: () => {
					if (editable) draft.commit();
				}
			}, index)),
			editable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "mc-guard-threshold-save",
				"data-guard-threshold-save": "true",
				disabled: !draft.dirty,
				onClick: () => {
					draft.commit();
				},
				children: t("guardThresholdSave")
			}) : null,
			editable && invalid ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "mc-guard-threshold-hint",
				role: "alert",
				"data-guard-threshold-invalid": "true",
				children: t("guardThresholdDraftHint")
			}) : null
		]
	});
}
/** Tagged after declaration: walkers must not CALL this one (it has hooks). */
GuardThresholdEditor[HOOK_COMPONENT] = true;
function GuardPanel(props) {
	const { t, enabled, duplicateThresholds, onToggle, onThresholdsChange } = props;
	const section = (entry) => {
		const isOn = enabled?.[entry.id] ?? false;
		const toggle = onToggle;
		const commitThresholds = onThresholdsChange;
		const belowBullets = entry.id === "duplicate_call" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "v3-gfoot-edit",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "mc-guard-threshold-edit",
				"data-guard-thresholds": "true",
				"data-guard-thresholds-count": String(duplicateThresholds?.length ?? 0),
				"data-guard-thresholds-values": duplicateThresholds?.join(",") ?? "",
				"data-guard-thresholds-editable": commitThresholds === void 0 ? "false" : "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GuardThresholdEditor, {
					t,
					...duplicateThresholds === void 0 ? {} : { thresholds: duplicateThresholds },
					...commitThresholds === void 0 ? {} : { onChange: commitThresholds }
				})
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "v3-hint mc-guard-threshold-hint",
				children: t("guardThresholdHint")
			})]
		}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			className: "v3-hint",
			children: t(entry.id === "alternating_cycle" ? "guardPurposeB" : "guardPurposeC")
		});
		const footNote = entry.id === "alternating_cycle" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "v3-gfoot-note",
			children: t("guardFootCycle")
		}) : entry.id === "no_progress" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "v3-gfoot-note",
			children: t("guardFootNoProgress")
		}) : null;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "v3-gitem",
			"data-guard-section": entry.id,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "v3-gh",
					children: [
						isOn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "v3-dot",
							"data-tone": "ok",
							"aria-hidden": "true"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "v3-dot",
							"aria-hidden": "true"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "v3-gnm",
							children: t(entry.titleKey)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "v3-gid",
							children: entry.id === "duplicate_call" ? "重复调用" : entry.id === "alternating_cycle" ? "交替循环" : "无进展"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "switch",
							"aria-checked": isOn ? "true" : "false",
							"aria-label": t(entry.titleKey),
							className: "v3-sw",
							disabled: toggle === void 0,
							onClick: () => {
								if (toggle !== void 0) toggle(entry.id, !isOn);
							}
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "v3-gpoints",
					children: entry.bodyKeys.map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
						className: "mc-guard-point",
						children: t(key)
					}, key))
				}),
				belowBullets,
				footNote === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "v3-gfoot",
					children: footNote
				})
			]
		}, entry.id);
	};
	const scopeCell = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "v3-gitem v3-gitem--info",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "v3-gh",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "v3-gnm",
					children: t("guardScopeTitle")
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("guardScopeBody") }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "v3-gfoot",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("guardScopeFoot") })
			})
		]
	}, "scope");
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: "mc-section v3-root",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(V3Styles, {}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", {
				"data-guard-style": "true",
				children: GUARD_CSS
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "v3-gpanel",
				children: [SECTIONS.map(section), scopeCell]
			})
		]
	});
}
//#endregion
//#region src/client/guard-section.tsx
/**
* 执行保护 — the single-page shell that wires {@link GuardPanel} to the real
* Guard switches (v3, D-044).
*
* 旧插件的执行保护页是「四页签外壳 + GuardContainer + GuardPanel」三层：外壳管
* 页签，container 管远端读写与轮询，panel 是纯视图。本插件只有一个设置页，外壳
* 不存在了，所以这一层只做 container 的活：读取开关 / 诊断 / 计数，写回开关与阈值，
* 失败给出可见错误行。页面本身仍然是「无标题、直接给看板」的 v3 风格。
*
* Failure handling is deliberate:
* - 读取开关失败 → 错误行 + 开关显示为不可用（disabled），绝不显示成「关」；
*   一个未知的开关状态不能看起来像用户的选择。
* - 写失败 → 错误行写明原因，并且重新读回 Host 的真相，不让开关声称 Host 没接受的状态。
* - 诊断 / 计数读取失败降级为「未知」（计数格显示「—」），不阻断整页。
* - 同一时刻只允许一次写入；写入期间开关与阈值编辑器都禁用。
* - 非法阈值列表（非升序 / 越界 / 超过 5 个）在本地就拦住，不发请求。
* - 写成功后不猜：必须重读 Host 并确认「读回值 = 期望值」才显示「已保存」；确认
*   不上就按错误处理，绝不与错误行同屏出现一句乐观的成功提示。
*
* 本文件只读 Guard 的四个远端方法，不碰会话历史、事件、调用索引或 usage。
*/
/**
* Whether the values the Host read back are the ones this page just wrote.
*
* `repeatThresholds` is an array, so it is compared element by element; every
* other switch field is a boolean. This is the ONLY gate that turns a write into
* a 「已保存」 — a value that came back different is not a success, whatever the
* RPC answered.
*/
function matchesGuardExpectation(switches, expect) {
	return Object.entries(expect).every(([key, want]) => {
		const actual = switches[key];
		if (Array.isArray(want)) return Array.isArray(actual) && actual.length === want.length && actual.every((value, index) => value === want[index]);
		return actual === want;
	});
}
/** Copy for one 已保存 tag; the new value is named so the reader sees WHAT landed. */
function savedText(notice, t) {
	if (notice.kind === "thresholds") return t("guardSavedThresholds");
	return t("guardSavedSwitch") + " · " + t(SECTION_TITLE[notice.id]) + " → " + t(notice.next ? "guardSwitchOn" : "guardSwitchOff");
}
/**
* The 已保存 tag, as a hook-free element.
*
* Hook-free on purpose: the page owns the timer and the confirmation, so the exact
* DOM (attribute names, tone, sequence) can be asserted without a DOM harness.
* `data-guard-saved` names WHAT was saved ('thresholds' or the section id), and
* `data-guard-saved-seq` lets a re-save be told apart from the previous tag.
*/
function GuardSavedTag(props) {
	const { t, notice } = props;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: "v3-tag mc-guard-saved",
		"data-tone": "ok",
		"data-guard-saved": notice.kind === "thresholds" ? "thresholds" : notice.id,
		"data-guard-saved-seq": String(notice.seq),
		"aria-live": "polite",
		children: savedText(notice, t)
	});
}
const INITIAL_STATE$1 = { busy: false };
/** Section id → the Guard switch it controls. */
const SECTION_FIELD = {
	duplicate_call: "duplicateDetection",
	alternating_cycle: "alternatingCycleDetection",
	no_progress: "noProgressProtection"
};
/** Section id → the card title, so a 已保存 tag can name what landed. */
const SECTION_TITLE = {
	duplicate_call: "guardSectionA",
	alternating_cycle: "guardSectionB",
	no_progress: "guardSectionC"
};
/** How long a 已保存 confirmation stays on screen before it is removed. */
const SAVED_HOLD_MS = 4e3;
/** Page-level rules; every colour comes from the v3 token layer. */
const SECTION_CSS = [
	".mc-guard-section.v3-root{display:flex;flex-direction:column;gap:12px}",
	".mc-guard-statusline{flex-wrap:wrap;row-gap:2px}",
	".mc-guard-statusline .mc-guard-status-why{color:var(--v3-t4)}",
	".mc-guard-statusline .mc-guard-status-why+.mc-guard-status-why::before{content:'·';margin-right:6px}",
	".mc-guard-statusline .mc-guard-status-why[data-guard-write-failed='true']{color:var(--v3-bad)}",
	".mc-guard-section .mc-guard-error{margin:0}",
	".mc-guard-section .mc-guard-error span{font-family:var(--v3-font-code);font-size:11px;color:var(--v3-t3);word-break:break-word}",
	".mc-guard-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
	".mc-guard-top .v3-statusline{flex:1 1 auto;min-width:0}",
	".mc-guard-saved{animation:mc-guard-saved-fade 4000ms ease forwards}",
	"@keyframes mc-guard-saved-fade{0%,85%{opacity:1}100%{opacity:0}}",
	"@media (prefers-reduced-motion:reduce){.mc-guard-saved{animation:none}}"
].join("");
/**
* Turn an unknown thrown value into a message safe to render.
*
* A rejected call carries a fixed code on the wire, but a THROWN transport error
* has no code — its message is the only reason worth showing the user.
*/
function errorText$1(error) {
	if (error instanceof Error && error.message !== "") return error.message;
	return String(error);
}
/** 'code: message' for a rejected remote result; the code names what broke. */
function failureText$1(error) {
	return error.code + ": " + error.message;
}
/**
* Run one OPTIONAL remote call and collapse every failure to `undefined`.
*
* Diagnostics and counters are diagnostic, not load-bearing: a rejected call, a
* synchronous throw from a malformed stub or a non-ok result must not blank the
* page the switch surface exists to show.
*/
async function readOptional$1(call) {
	try {
		const result = await call();
		return result.ok ? result.value : void 0;
	} catch {
		return;
	}
}
/** Read the switches, keeping the failure reason instead of throwing. */
async function readSwitches(remote) {
	try {
		const result = await remote.getGuard();
		return result.ok ? {
			ok: true,
			value: result.value
		} : {
			ok: false,
			detail: failureText$1(result.error)
		};
	} catch (error) {
		return {
			ok: false,
			detail: errorText$1(error)
		};
	}
}
/** Copy for one wire diagnostic reason. Never free-form text off the wire. */
function reasonText(t, reason) {
	return reason === "invalid-patch" ? t("guardDiagInvalidPatch") : t("guardDiagNotMounted");
}
/**
* The top status line: whether the Guard is actually in effect right now.
*
* Hook-free so it can be rendered (and asserted) on its own. The three "cannot
* know" states are distinct on purpose: still loading is not the same as a
* failed read, and neither may be shown as 「已生效」 or as 「未生效」.
*/
function GuardStatusLine(props) {
	const { t, diagnostics, error } = props;
	const status = diagnostics === void 0 ? error === void 0 ? "pending" : "unknown" : diagnostics.available ? "ok" : "bad";
	const summary = status === "ok" ? t("guardStatusAvailable") : status === "bad" ? t("guardStatusUnavailable") : status === "unknown" ? t("guardStatusUnknown") : t("guardStatusLoading");
	const tone = status === "ok" ? "ok" : status === "bad" ? "bad" : void 0;
	const persistence = diagnostics?.persistence;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "v3-statusline mc-guard-statusline",
		"data-guard-status": status,
		role: "status",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "v3-dot",
				"data-tone": tone,
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: summary }),
			status === "bad" && diagnostics !== void 0 ? diagnostics.reasons.map((reason) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "mc-guard-status-why",
				"data-guard-reason": reason,
				children: reasonText(t, reason)
			}, reason)) : null,
			persistence?.dirty === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "mc-guard-status-why",
				"data-guard-persistence": persistence.lastErrorCode ?? "pending",
				children: t("guardDiagPersistenceDirty")
			}) : null,
			persistence?.lastErrorCode === "write-failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "mc-guard-status-why",
				"data-guard-write-failed": "true",
				children: t("guardDiagWriteFailed")
			}) : null
		]
	});
}
/**
* The 执行保护 page.
*
* Mounts → reads switches + diagnostics + counters in parallel; a switch click
* writes one field and re-reads the accepted configuration; a threshold commit
* validates locally, then writes the whole list. Every write ends by reading the
* Host back, so the page never presents an optimistic value as the truth.
*/
function GuardSection(props) {
	const { remote, t } = props;
	const [state, setState] = (0, react.useState)(INITIAL_STATE$1);
	const alive = (0, react.useRef)(true);
	/** Monotonic request generation: only the newest request may commit. */
	const gen = (0, react.useRef)(0);
	/** Latest committed state, read synchronously by a queued write. */
	const stateRef = (0, react.useRef)(INITIAL_STATE$1);
	/** The 已保存 tag currently on screen (null = none). */
	const [saved, setSaved] = (0, react.useState)(null);
	/** Its auto-dismiss timer; one at a time, re-armed by every new save. */
	const savedTimer = (0, react.useRef)(void 0);
	const savedSeq = (0, react.useRef)(0);
	const nextGen = (0, react.useCallback)(() => {
		gen.current += 1;
		return gen.current;
	}, []);
	/**
	* Apply a state change only while this generation is still the newest.
	*
	* The updater runs against `stateRef` (the latest committed state), so a write
	* that follows a read sees that read's result instead of a stale render closure.
	*/
	const commit = (0, react.useCallback)((at, patch) => {
		if (!alive.current || at !== gen.current) return;
		const next = patch(stateRef.current);
		if (next === stateRef.current) return;
		stateRef.current = next;
		setState(next);
	}, []);
	/**
	* Read switches, then the two optional surfaces, and publish the result.
	*
	* Returns the accepted switch values so a caller can decide whether the write
	* it just issued really landed; `undefined` means the read itself failed, and
	* that failure is already published on the error line.
	*/
	const readAll = (0, react.useCallback)(async (at) => {
		const switches = await readSwitches(remote);
		if (!alive.current || at !== gen.current) return void 0;
		if (!switches.ok) {
			commit(at, (current) => ({
				...current,
				busy: false,
				error: {
					kind: "read",
					detail: switches.detail
				}
			}));
			return;
		}
		const diagnostics = await readOptional$1(() => remote.getGuardDiagnostics());
		if (!alive.current || at !== gen.current) return void 0;
		commit(at, () => ({
			switches: switches.value,
			busy: false,
			...diagnostics === void 0 ? {} : { diagnostics }
		}));
		return switches.value;
	}, [remote, commit]);
	(0, react.useEffect)(() => {
		alive.current = true;
		const at = nextGen();
		readAll(at);
		return () => {
			alive.current = false;
			gen.current += 1;
			if (savedTimer.current !== void 0) {
				clearTimeout(savedTimer.current);
				savedTimer.current = void 0;
			}
		};
	}, [readAll, nextGen]);
	/** Drop any 已保存 tag (and its timer) before a new write starts. */
	const clearSaved = (0, react.useCallback)(() => {
		if (savedTimer.current !== void 0) {
			clearTimeout(savedTimer.current);
			savedTimer.current = void 0;
		}
		setSaved(null);
	}, []);
	/**
	* Show a 已保存 confirmation for {@link SAVED_HOLD_MS}.
	*
	* The sequence number is stored WITH the notice, so an older tag's dismissal can
	* never remove a newer one, and re-saving the same value restarts the hold
	* instead of quietly extending a node that is already fading out.
	*/
	const showSaved = (0, react.useCallback)((intent) => {
		if (savedTimer.current !== void 0) clearTimeout(savedTimer.current);
		savedSeq.current += 1;
		const seq = savedSeq.current;
		setSaved({
			...intent,
			seq
		});
		savedTimer.current = setTimeout(() => {
			savedTimer.current = void 0;
			setSaved((current) => current !== null && current.seq === seq ? null : current);
		}, SAVED_HOLD_MS);
	}, []);
	/**
	* One write, then an authoritative re-read, then — ONLY if that read-back
	* matches what was asked for — a visible 「已保存」.
	*
	* No optimistic switch movement and no optimistic confirmation: the panel keeps
	* showing the Host's value until the Host accepted the change, and a write whose
	* read-back disagrees is reported as unconfirmed instead of celebrated.
	*/
	const write = (0, react.useCallback)(async (change, expect, intent) => {
		if (stateRef.current.busy) return;
		clearSaved();
		const at = nextGen();
		commit(at, (current) => ({
			...current,
			busy: true,
			error: void 0
		}));
		let result;
		try {
			result = await remote.updateGuard(change);
		} catch (error) {
			if (!alive.current || at !== gen.current) return;
			commit(at, (current) => ({
				...current,
				busy: false,
				error: {
					kind: "write",
					detail: errorText$1(error)
				}
			}));
			return;
		}
		if (!alive.current || at !== gen.current) return;
		if (!result.ok) {
			const detail = failureText$1(result.error);
			commit(at, (current) => ({
				...current,
				busy: false,
				error: {
					kind: "write",
					detail
				}
			}));
			return;
		}
		const confirmed = await readAll(at);
		if (!alive.current || at !== gen.current) return;
		if (confirmed === void 0) return;
		if (!matchesGuardExpectation(confirmed, expect)) {
			commit(at, (current) => ({
				...current,
				busy: false,
				error: {
					kind: "unconfirmed",
					detail: ""
				}
			}));
			return;
		}
		showSaved(intent);
	}, [
		remote,
		commit,
		nextGen,
		readAll,
		clearSaved,
		showSaved
	]);
	/** Switch click → one field write, confirmed by the read-back. */
	const toggle = (0, react.useCallback)((id, next) => {
		const change = { [SECTION_FIELD[id]]: next };
		write(change, change, {
			kind: "switch",
			id,
			next
		});
	}, [write]);
	/**
	* Threshold commit.
	*
	* The panel's draft already refuses an invalid list, but the list is checked
	* again here: this is the only place that can turn an edit into a wire write,
	* and an out-of-range / non-ascending list would be rejected by the Host with
	* a code that says nothing useful to the person who typed it.
	*/
	const changeThresholds = (0, react.useCallback)((next) => {
		if (!isGuardThresholdListValid(next)) {
			clearSaved();
			const at = nextGen();
			commit(at, (current) => ({
				...current,
				error: {
					kind: "threshold",
					detail: ""
				}
			}));
			return;
		}
		const change = { repeatThresholds: next };
		write(change, change, { kind: "thresholds" });
	}, [
		write,
		commit,
		nextGen,
		clearSaved
	]);
	const { switches, diagnostics, error, busy } = state;
	const enabled = switches === void 0 ? void 0 : {
		duplicate_call: switches.duplicateDetection,
		alternating_cycle: switches.alternatingCycleDetection,
		no_progress: switches.noProgressProtection
	};
	const interactive = switches !== void 0 && !busy;
	const errorTitle = error === void 0 ? void 0 : error.kind === "read" ? t("guardReadFailed") : error.kind === "threshold" ? t("guardThresholdDraftHint") : error.kind === "unconfirmed" ? t("guardSaveUnconfirmed") : t("guardWriteFailed");
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: "v3-root mc-guard-section",
		"data-guard-busy": busy ? "true" : "false",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(V3Styles, {}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", {
				"data-guard-section-style": "true",
				children: SECTION_CSS
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mc-guard-top",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GuardStatusLine, {
					t,
					diagnostics,
					error
				}), saved === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GuardSavedTag, {
					t,
					notice: saved
				}, saved.seq)]
			}),
			error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "v3-banner mc-guard-error",
				role: "alert",
				"data-guard-error": error.kind,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: errorTitle }), error.detail === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error.detail })]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GuardPanel, {
				t,
				...enabled === void 0 ? {} : { enabled },
				...switches === void 0 ? {} : { duplicateThresholds: switches.repeatThresholds },
				...interactive ? {
					onToggle: toggle,
					onThresholdsChange: changeThresholds
				} : {}
			})
		]
	});
}
/**
* 本页文案（zh / en），键与 {@link GuardSectionKey} 一一对应。
*
* 中文说明沿用旧插件 GuardContainer / PluginSection 里已发布的版本，只把「诊断
* 原因」压短到适合状态行的一行（原句是长段落），并新增三档「正在读取 / 已生效 /
* 状态未知」措辞。由 index.ts 注册进 locale，本文件不自己持有命名空间。
*/
function guardDictionaries() {
	return {
		zh: {
			nav: "思考限制",
			title: "思考限制",
			desc: "只针对有证据的重复与无进展拦截具体操作；不因总步数、工具总次数或任务时长终止任务。",
			guardStatusLoading: "正在读取思考限制状态…",
			guardStatusAvailable: "思考限制已生效",
			guardStatusUnavailable: "思考限制当前未生效",
			guardStatusUnknown: "思考限制状态未知",
			guardDiagInvalidPatch: "配置非法，执行保护未注册任何钩子",
			guardDiagNotMounted: "本进程未挂载执行保护",
			guardDiagPersistenceDirty: "有未落盘改动，下次保存成功后会自动补写",
			guardDiagWriteFailed: "状态文件写入失败，改动只保留在内存中",
			guardReadFailed: "读取思考限制设置失败",
			guardWriteFailed: "保存思考限制设置失败",
			guardSaveUnconfirmed: "已提交，但读回值不同，未确认生效",
			guardSavedSwitch: "已保存",
			guardSavedThresholds: "阈值已保存",
			guardSwitchOn: "开",
			guardSwitchOff: "关",
			guardStatsTitle: "思考限制活动",
			guardStatObservations: "已观察调用",
			guardStatObservationsHint: "执行保护实际观察到的工具调用数",
			guardStatObservationsZeroHint: "本进程启动后还没有工具调用经过执行保护；若你一直在用工具，这里仍是 0 就说明执行保护没生效。",
			guardStatOutcomes: "成功 / 失败",
			guardStatOutcomesHint: "被观察调用的结果分布",
			guardStatReminders: "提醒（重复 / 交替）",
			guardStatRemindersHint: "实际发出的提醒次数",
			guardStatDenials: "局部拒绝",
			guardStatDenialsHint: "实际阻止的重复调用次数",
			guardThresholds: "重复提醒阈值",
			guardThresholdSave: "保存",
			guardThresholdDraftHint: "需为 2–50 的递增整数、最多 5 个；未合法前不会提交。",
			guardBoundaryShort: "这里的数字只用于展示，不构成硬停止；三档阈值只参与校验与计数，不产生提醒也不停止任务。",
			guardThresholdHint: "默认 3 / 5 / 8 次，分别在第 3、5、8 次重复时提醒；最高阈值还会作为无进展候选门槛，是否局部拒绝由 C 与证据决定。",
			guardSectionA: "A · 相同调用重复提醒",
			guardSectionB: "B · 交替循环识别",
			guardSectionC: "C · 无进展保护",
			guardABody1: "检查相同工具 + 相同参数的重复调用。",
			guardABody2: "重复提醒阈值可编辑（默认 3 / 5 / 8 次）；与交替循环检测相互独立，两个开关都不会压住对方。",
			guardABody3: "达到阈值只提醒，并以结果/错误指纹为证据判断是否真的重复。",
			guardBBody1: "识别 A → B → A → B 这样的交替调用序列。",
			guardBBody2: "只用工具调用序列与可获得的「结果 / 错误指纹」判断是否连续多轮没有新结果，不会为了判断循环额外请求一次模型。",
			guardBBody3: "命中后给出可理解的说明，例如「两个操作反复交替，连续多轮没有产生新结果」。",
			guardCBody1: "只有证据足够明确时，才阻止已证实重复的「具体操作」。",
			guardCBody2: "每个 Turn 对同一个已证实的重复操作只局部拒绝一次；不结束整个任务，Agent 仍可收尾或换方法。",
			guardCBody3: "日志缺失、结果无法比较、识别不确定时降级为提醒，不拦截。",
			guardPurposeB: "作用：识别 A→B→A→B 这类交替循环并提醒，避免来回空转。",
			guardPurposeC: "作用：证据明确时拦下已证实的重复操作，其余情况只提醒。",
			guardFired: "实际触发",
			guardFootCycle: "命中后只给出说明，不阻断调用",
			guardFootNoProgress: "降级条件　日志缺失 · 结果不可比较 · 识别不确定",
			guardScopeTitle: "生效范围",
			guardScopeBody: "三个开关按智能体 / 回合隔离，不跨会话继承；关闭只停止对应的提醒与局部拒绝，不改动任何配置或历史。",
			guardScopeFoot: "恢复默认只写回开关值，不重写其他配置"
		},
		en: {
			nav: "Execution Protection",
			title: "Execution Protection",
			desc: "Blocks specific operations only when there is evidence of repetition or no progress; never stops a task for step count, tool count or duration.",
			guardStatusLoading: "Reading guard status…",
			guardStatusAvailable: "Execution guard is active",
			guardStatusUnavailable: "Execution guard is not in effect",
			guardStatusUnknown: "Guard status unknown",
			guardDiagInvalidPatch: "Invalid configuration; no Guard hook is registered",
			guardDiagNotMounted: "The Guard is not mounted in this process",
			guardDiagPersistenceDirty: "Unsaved changes; they are written after the next successful save",
			guardDiagWriteFailed: "Writing the state file failed; the change is kept in memory only",
			guardReadFailed: "Failed to read the guard settings",
			guardWriteFailed: "Failed to save the guard settings",
			guardSaveUnconfirmed: "Submitted, but the read-back differs; not confirmed",
			guardSavedSwitch: "Saved",
			guardSavedThresholds: "Thresholds saved",
			guardSwitchOn: "On",
			guardSwitchOff: "Off",
			guardStatsTitle: "Guard activity",
			guardStatObservations: "Calls observed",
			guardStatObservationsHint: "Tool calls the Guard actually inspected",
			guardStatObservationsZeroHint: "No tool call has reached the Guard since this process started; counts are never backfilled. If you have been calling tools, a 0 here means the Guard is not running.",
			guardStatOutcomes: "Succeeded / failed",
			guardStatOutcomesHint: "Outcome split of the observed calls",
			guardStatReminders: "Reminders (repeat / cycle)",
			guardStatRemindersHint: "Reminders actually delivered",
			guardStatDenials: "Local denials",
			guardStatDenialsHint: "Repeated calls actually blocked",
			guardThresholds: "Repeat reminder thresholds",
			guardThresholdSave: "Save",
			guardThresholdDraftHint: "Needs 2–50 ascending integers, at most 5; nothing is submitted until it is valid.",
			guardBoundaryShort: "These numbers are informational only and never stop a task; the three tier thresholds participate in validation and counting only.",
			guardThresholdHint: "Defaults are 3 / 5 / 8, reminding on the 3rd, 5th and 8th repeat; the highest value also gates no-progress candidates, and a local denial is decided by C together with the evidence.",
			guardSectionA: "A · Repeated identical calls",
			guardSectionB: "B · Alternating cycle detection",
			guardSectionC: "C · No-progress protection",
			guardABody1: "Checks calls that repeat the same tool with the same arguments.",
			guardABody2: "Repeat reminder thresholds are editable (default 3 / 5 / 8); repeat and alternating-cycle detection stay independent, and neither switch suppresses the other.",
			guardABody3: "Reaching a threshold only reminds, and repetition is confirmed by result/error fingerprints.",
			guardBBody1: "Detects alternating sequences such as A -> B -> A -> B.",
			guardBBody2: "Judges no-new-result purely from the call sequence and available result/error fingerprints; it never spends an extra model request to decide whether a loop exists.",
			guardBBody3: "When it fires it explains the pattern, for example \"two operations keep alternating without producing a new result\".",
			guardCBody1: "Blocks a specific operation only when the evidence is unambiguous.",
			guardCBody2: "A given confirmed repeat is denied at most once per turn; the task is never ended, so the agent can still wrap up or change approach.",
			guardCBody3: "Missing logs, incomparable results, or an uncertain match degrade to a reminder instead of a block.",
			guardPurposeB: "Purpose: detect alternating A→B→A→B cycles and remind, so the agent stops going in circles.",
			guardPurposeC: "Purpose: block a confirmed repeat when the evidence is clear; otherwise only remind.",
			guardFired: "Fired",
			guardFootCycle: "Fires an explanation only; it never blocks the call.",
			guardFootNoProgress: "Degrades when: logs missing · results incomparable · match uncertain",
			guardScopeTitle: "Scope",
			guardScopeBody: "The three switches are isolated per Agent / turn and never inherited across Sessions; turning one off stops only its reminders and local denials, and changes no configuration or history.",
			guardScopeFoot: "Restoring defaults writes only the switch values; no other configuration is rewritten."
		}
	};
}
//#endregion
//#region src/client/overview-section.tsx
/**
* 总览 — one page, two records, both traceable to a real source (v3, D-044).
*
* 本页只回答「现在什么状态」，不回答「刚才发生了什么」：所有数字都来自三个不含
* 会话内容的来源 ——
*   1. Guard 进程内计数（`getGuardStats`，重启归零）；
*   2. Guard 状态文件里的开关与诊断（`getGuard` / `getGuardDiagnostics`）；
*   3. 能力目录快照（`classifyAll` / `catalogVersion` / `getDiagnostics`）。
*
* 刻意不读会话历史：没有任何会话事件流、持久化会话索引或调用统计的代码。
* 因此每张卡片底部都有一行「来源」小字，写明这堆数字是从哪一层读来
* 的、什么时候会归零，避免把「进程内计数」误读成「历史总数」。
*
* 行为：挂载时读一次 + 一个「刷新」按钮，不轮询。两张卡片各自独立，一张读失败只
* 影响它自己的错误行，另一张照常显示；读不到的数字显示「—」，绝不伪造成 0。
*/
const INITIAL_STATE = { busy: true };
/** Page-level rules; every colour comes from the v3 token layer. */
const OVERVIEW_CSS = [
	".mc-overview-section.v3-root{display:flex;flex-direction:column;gap:12px}",
	".mc-overview-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
	".mc-overview-bar .v3-hint{flex:1 1 240px;min-width:0}",
	".mc-overview-refresh{margin-left:auto;flex:none;padding:4px 12px;border-radius:var(--v3-r-sm);font-size:11.5px;color:var(--v3-t1);background:var(--v3-panel-2);border:1px solid var(--v3-line);cursor:pointer}",
	".mc-overview-refresh:disabled{opacity:.5;cursor:default}",
	".mc-overview-refresh:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}",
	".mc-overview-card{display:flex;flex-direction:column;gap:10px}",
	".mc-overview-title{margin:0;font-size:13px;font-weight:600;color:var(--v3-t1)}",
	".mc-overview-kv{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
	".mc-overview-k{font-size:11px;color:var(--v3-t4)}",
	".mc-overview-meta{margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
	".mc-overview-meta b{font-weight:600;color:var(--v3-t2);font-variant-numeric:tabular-nums}",
	".mc-overview-diag{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
	".mc-overview-hint-names{margin:0}",
	".mc-overview-source{margin:0;padding-top:8px;border-top:1px solid var(--v3-line)}",
	".mc-overview-error{margin:0}",
	".mc-overview-error span{font-family:var(--v3-font-code);font-size:11px;color:var(--v3-t3);word-break:break-word}"
].join("");
/** '—' for a value that was not read; never a fabricated zero. */
function dash(value) {
	return value === void 0 || !Number.isFinite(value) ? "—" : String(value);
}
/** Turn an unknown thrown value into a message safe to render. */
function errorText(error) {
	if (error instanceof Error && error.message !== "") return error.message;
	return String(error);
}
/** 'code: message' for a rejected remote result; the code names what broke. */
function failureText(error) {
	return error.code + ": " + error.message;
}
/**
* Run one remote call, collapsing every failure to a discriminated result.
*
* Both shapes are kept because the two cards degrade differently: a missing Guard
* counter is 「—」 (diagnostic, not load-bearing), while a missing switch value or
* classification list must surface as an error line on its own card.
*/
async function readResult(call) {
	try {
		const result = await call();
		return result.ok ? {
			ok: true,
			value: result.value
		} : {
			ok: false,
			detail: failureText(result.error)
		};
	} catch (error) {
		return {
			ok: false,
			detail: errorText(error)
		};
	}
}
/** Optional channel: any failure is just "unknown" for this number. */
async function readOptional(call) {
	const result = await readResult(call);
	return result.ok ? result.value : void 0;
}
/**
* Read the three Guard faces for one card.
*
* The switch list is the load-bearing read (it is what the card is FOR), so its
* failure becomes the card's error line; counters and diagnostics degrade to
* 「未知」 / 「—」 instead, because a page that loses its counters must still tell
* the operator whether the Guard is switched on.
*/
async function readGuard(remote) {
	const [switches, stats, diagnostics] = await Promise.all([
		readResult(() => remote.getGuard()),
		readOptional(() => remote.getGuardStats()),
		readOptional(() => remote.getGuardDiagnostics())
	]);
	return {
		...switches.ok ? { switches: switches.value } : { error: switches.detail },
		...stats === void 0 ? {} : { stats },
		...diagnostics === void 0 ? {} : { diagnostics }
	};
}
/**
* Read the capability catalog for one card.
*
* `classifyAll` is the load-bearing read (the three tier counts and the total);
* the version number and the capability diagnostics are optional channels, so a
* Host without them shows 「—」 / 「未知」 instead of failing the card. The observed
* time is stamped HERE, in the browser, at the moment the snapshot arrived — it
* is labeled as this page's observation time on purpose, because the Host never
* tells us when its catalog was last rebuilt.
*/
async function readCatalog(remote) {
	const [rows, version, diagnostics] = await Promise.all([
		readResult(() => remote.classifyAll()),
		readOptional(() => remote.catalogVersion()),
		remote.getDiagnostics === void 0 ? Promise.resolve(void 0) : readOptional(() => remote.getDiagnostics())
	]);
	return {
		...rows.ok ? {
			rows: rows.value,
			observedAt: (/* @__PURE__ */ new Date()).toLocaleTimeString()
		} : { error: rows.detail },
		...version === void 0 ? {} : { version },
		...diagnostics === void 0 ? {} : { diagnostics }
	};
}
/** Tier tally of one classification list. */
function countRows(rows) {
	if (rows === void 0) return {
		resident: void 0,
		onDemand: void 0,
		disabled: void 0,
		total: void 0,
		tools: void 0,
		skills: void 0
	};
	let resident = 0;
	let onDemand = 0;
	let disabled = 0;
	let tools = 0;
	for (const row of rows) {
		if (row.class === "resident") resident += 1;
		else if (row.class === "on-demand") onDemand += 1;
		else disabled += 1;
		if (row.kind === "tool") tools += 1;
	}
	return {
		resident,
		onDemand,
		disabled,
		total: rows.length,
		tools,
		skills: rows.length - tools
	};
}
/** One stat cell; the hint carries the RPC name so the number is traceable. */
function StatCell(props) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "v3-stat",
		"data-overview-stat": props.stat,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "v3-stat-l",
				children: props.label
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "v3-stat-v",
				children: props.value
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "v3-stat-d",
				children: props.hint
			})
		]
	});
}
/** One labeled switch state chip. */
function SwitchChip(props) {
	const { t, label, on, name } = props;
	const text = on === void 0 ? t("overviewUnknown") : on ? t("overviewSwitchOn") : t("overviewSwitchOff");
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "mc-overview-kv",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "mc-overview-k",
			children: label
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "v3-tag",
			"data-tone": on === void 0 ? void 0 : on ? "ok" : void 0,
			"data-overview-switch": name,
			children: text
		})]
	});
}
/** Join at most `limit` names for a diagnostic line. */
function namesText(names, limit) {
	return names.slice(0, limit).join(" · ");
}
/**
* The 总览 page: 执行保护记录 + 能力菜单记录.
*
* Reads once on mount and again on 刷新; each card owns its own error line, so a
* broken capability remote cannot blank the Guard record (or the reverse).
*/
function OverviewSection(props) {
	const { guardRemote, capabilityRemote, t } = props;
	const [state, setState] = (0, react.useState)(INITIAL_STATE);
	const alive = (0, react.useRef)(true);
	/** Monotonic generation: a slow older read must never overwrite a newer one. */
	const gen = (0, react.useRef)(0);
	const stateRef = (0, react.useRef)(INITIAL_STATE);
	const commit = (0, react.useCallback)((at, patch) => {
		if (!alive.current || at !== gen.current) return;
		const next = patch(stateRef.current);
		if (next === stateRef.current) return;
		stateRef.current = next;
		setState(next);
	}, []);
	/**
	* One full read of both cards.
	*
	* The two reads overlap, and a failure on one side is stored on its own side —
	* the payload keeps whatever the other side did return, so 刷新 after a transient
	* failure cannot silently clear a good card.
	*/
	const load = (0, react.useCallback)(async () => {
		gen.current += 1;
		const at = gen.current;
		commit(at, (current) => ({
			...current,
			busy: true
		}));
		const [guard, catalog] = await Promise.all([readGuard(guardRemote), readCatalog(capabilityRemote)]);
		if (!alive.current || at !== gen.current) return;
		commit(at, (current) => ({
			...current,
			busy: false,
			...guard.switches === void 0 ? {} : { guardSwitches: guard.switches },
			...guard.stats === void 0 ? {} : { guardStats: guard.stats },
			...guard.diagnostics === void 0 ? {} : { guardDiagnostics: guard.diagnostics },
			...guard.error === void 0 ? { guardError: void 0 } : { guardError: guard.error },
			...catalog.rows === void 0 ? {} : { catalogRows: catalog.rows },
			...catalog.version === void 0 ? {} : { catalogVersion: catalog.version },
			...catalog.diagnostics === void 0 ? {} : { catalogDiagnostics: catalog.diagnostics },
			...catalog.observedAt === void 0 ? {} : { observedAt: catalog.observedAt },
			...catalog.error === void 0 ? { catalogError: void 0 } : { catalogError: catalog.error }
		}));
	}, [
		guardRemote,
		capabilityRemote,
		commit
	]);
	(0, react.useEffect)(() => {
		alive.current = true;
		load();
		return () => {
			alive.current = false;
			gen.current += 1;
		};
	}, [load]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewView, {
		t,
		busy: state.busy,
		guard: {
			...state.guardSwitches === void 0 ? {} : { switches: state.guardSwitches },
			...state.guardStats === void 0 ? {} : { stats: state.guardStats },
			...state.guardDiagnostics === void 0 ? {} : { diagnostics: state.guardDiagnostics },
			...state.guardError === void 0 ? {} : { error: state.guardError }
		},
		catalog: {
			...state.catalogRows === void 0 ? {} : { rows: state.catalogRows },
			...state.catalogVersion === void 0 ? {} : { version: state.catalogVersion },
			...state.catalogDiagnostics === void 0 ? {} : { diagnostics: state.catalogDiagnostics },
			...state.catalogError === void 0 ? {} : { error: state.catalogError },
			...state.observedAt === void 0 ? {} : { observedAt: state.observedAt }
		},
		onRefresh: () => {
			load();
		}
	});
}
/**
* Pure view: no hooks, so a test can call it as a plain function and walk the
* returned element tree (the same pattern `PluginSectionView` uses).
*/
function OverviewView(props) {
	const { t, guard, catalog, busy, onRefresh } = props;
	const { switches: guardSwitches, stats: guardStats, diagnostics: guardDiagnostics, error: guardError } = guard;
	const { rows: catalogRows, version: catalogVersion, diagnostics: catalogDiagnostics, error: catalogError, observedAt } = catalog;
	const counts = countRows(catalogRows);
	const guardReasons = guardDiagnostics?.reasons ?? [];
	const guardPersistence = guardDiagnostics?.persistence;
	const catalogUnavailable = catalogDiagnostics?.unavailableSkills.length;
	const catalogShadowed = catalogDiagnostics?.shadowedSkills.length;
	const catalogBroken = catalogDiagnostics?.brokenPresets.length;
	const catalogClean = catalogDiagnostics !== void 0 && catalogUnavailable === 0 && catalogShadowed === 0 && catalogBroken === 0;
	const source = (kind, text) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		className: "v3-hint mc-overview-source",
		"data-overview-source": kind,
		children: text
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: "v3-root mc-overview-section",
		"data-overview-busy": busy ? "true" : "false",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(V3Styles, {}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", {
				"data-overview-style": "true",
				children: OVERVIEW_CSS
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mc-overview-bar",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "v3-hint",
					children: t("desc")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "mc-overview-refresh",
					"data-overview-refresh": "true",
					disabled: busy || onRefresh === void 0,
					onClick: () => {
						if (onRefresh !== void 0) onRefresh();
					},
					children: busy ? t("overviewRefreshing") : t("overviewRefresh")
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "v3-panel mc-overview-card",
				"data-overview-card": "guard",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "mc-overview-title",
						children: t("overviewGuardTitle")
					}),
					guardSwitches === void 0 && guardStats === void 0 && guardDiagnostics === void 0 && guardError === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "v3-hint",
						"data-overview-loading": "guard",
						children: t("overviewLoading")
					}) : null,
					guardError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "v3-banner mc-overview-error",
						role: "alert",
						"data-overview-error": "guard",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t("overviewGuardError") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: guardError })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "v3-stats",
						"data-overview-stats": "guard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCell, {
								stat: "observations",
								label: t("overviewGuardObservations"),
								value: dash(guardStats?.observations),
								hint: "进程内计数"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCell, {
								stat: "repeat",
								label: t("overviewGuardRepeat"),
								value: dash(guardStats?.reminders.repeat),
								hint: "进程内计数"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCell, {
								stat: "cycle",
								label: t("overviewGuardCycle"),
								value: dash(guardStats?.reminders.cycle),
								hint: "进程内计数"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCell, {
								stat: "denials",
								label: t("overviewGuardDenials"),
								value: dash(guardStats?.denials),
								hint: "进程内计数"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-overview-diag",
						"data-overview-switches": "guard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mc-overview-k",
								children: t("overviewGuardSwitches")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchChip, {
								t,
								label: t("overviewGuardMaster"),
								on: guardSwitches?.enabled,
								name: "enabled"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchChip, {
								t,
								label: t("overviewGuardDuplicate"),
								on: guardSwitches?.duplicateDetection,
								name: "duplicateDetection"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchChip, {
								t,
								label: t("overviewGuardCycleSwitch"),
								on: guardSwitches?.alternatingCycleDetection,
								name: "alternatingCycleDetection"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchChip, {
								t,
								label: t("overviewGuardNoProgress"),
								on: guardSwitches?.noProgressProtection,
								name: "noProgressProtection"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-overview-diag",
						"data-overview-diag": "guard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mc-overview-k",
								children: t("overviewGuardDiag")
							}),
							guardDiagnostics === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-overview-available": "unknown",
								children: t("overviewUnknown")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-tone": guardDiagnostics.available ? "ok" : "bad",
								"data-overview-available": guardDiagnostics.available ? "true" : "false",
								children: t(guardDiagnostics.available ? "overviewGuardEffective" : "overviewGuardNotEffective")
							}),
							guardReasons.includes("invalid-patch") ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-tone": "bad",
								"data-overview-reason": "invalid-patch",
								children: t("overviewDiagInvalidPatch")
							}) : null,
							guardReasons.includes("not-mounted") ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-tone": "bad",
								"data-overview-reason": "not-mounted",
								children: t("overviewDiagNotMounted")
							}) : null,
							guardPersistence?.dirty === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-tone": "warn",
								"data-overview-persistence": guardPersistence.lastErrorCode ?? "pending",
								children: t("overviewDiagPersistenceDirty")
							}) : null,
							guardPersistence?.lastErrorCode === "write-failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-tone": "bad",
								"data-overview-write-failed": "true",
								children: t("overviewDiagWriteFailed")
							}) : null
						]
					}),
					source("guard", t("overviewGuardSource"))
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "v3-panel mc-overview-card",
				"data-overview-card": "catalog",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "mc-overview-title",
						children: t("overviewCatalogTitle")
					}),
					catalogRows === void 0 && catalogVersion === void 0 && catalogDiagnostics === void 0 && catalogError === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "v3-hint",
						"data-overview-loading": "catalog",
						children: t("overviewLoading")
					}) : null,
					catalogError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "v3-banner mc-overview-error",
						role: "alert",
						"data-overview-error": "catalog",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t("overviewCatalogError") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: catalogError })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "v3-stats",
						"data-overview-stats": "catalog",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCell, {
								stat: "resident",
								label: t("overviewCatalogResident"),
								value: dash(counts.resident),
								hint: "目录快照"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCell, {
								stat: "on-demand",
								label: t("overviewCatalogOnDemand"),
								value: dash(counts.onDemand),
								hint: "目录快照"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCell, {
								stat: "disabled",
								label: t("overviewCatalogDisabled"),
								value: dash(counts.disabled),
								hint: "目录快照"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCell, {
								stat: "total",
								label: t("overviewCatalogTotal"),
								value: dash(counts.total),
								hint: "目录快照"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "mc-overview-meta",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mc-overview-k",
								children: t("overviewCatalogVersion")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
								"data-overview-version": true,
								children: dash(catalogVersion)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mc-overview-k",
								children: t("overviewCatalogObservedAt")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
								"data-overview-observed-at": true,
								children: observedAt ?? "—"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mc-overview-k",
								children: t("overviewCatalogTools")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
								"data-overview-tools": true,
								children: dash(counts.tools)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mc-overview-k",
								children: t("overviewCatalogSkills")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
								"data-overview-skills": true,
								children: dash(counts.skills)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "v3-hint",
						"data-overview-skills-hint": "true",
						children: t("overviewCatalogSkillsHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-overview-diag",
						"data-overview-diag": "catalog",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "mc-overview-k",
							children: t("overviewCatalogDiag")
						}), catalogDiagnostics === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "v3-tag",
							"data-overview-catalog-diag": "unknown",
							children: t("overviewUnknown")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mc-overview-k",
								children: t("overviewCatalogState")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-tone": catalogDiagnostics.catalog.state === "ready" ? "ok" : void 0,
								"data-overview-catalog-state": catalogDiagnostics.catalog.state,
								children: t(catalogDiagnostics.catalog.state === "empty" ? "overviewCatalogStateEmpty" : "overviewCatalogStateReady")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-tone": catalogUnavailable === 0 ? void 0 : "warn",
								"data-overview-diag-unavailable": String(catalogUnavailable),
								children: t("overviewCatalogDiagUnavailable") + " " + String(catalogUnavailable)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-tone": catalogShadowed === 0 ? void 0 : "warn",
								"data-overview-diag-shadowed": String(catalogShadowed),
								children: t("overviewCatalogDiagShadowed") + " " + String(catalogShadowed)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								"data-tone": catalogBroken === 0 ? void 0 : "bad",
								"data-overview-diag-broken": String(catalogBroken),
								children: t("overviewCatalogDiagBrokenPreset") + " " + String(catalogBroken)
							}),
							catalogClean ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-tag",
								children: t("overviewDiagNone")
							}) : null
						] })]
					}),
					catalogDiagnostics === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "v3-hint",
						"data-overview-state-hint": "true",
						children: t("overviewCatalogStateHint")
					}),
					catalogDiagnostics !== void 0 && (catalogUnavailable ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "v3-hint mc-overview-hint-names",
						"data-overview-names": "unavailable",
						children: namesText(catalogDiagnostics.unavailableSkills.map((item) => item.name), 4)
					}) : null,
					catalogDiagnostics !== void 0 && (catalogShadowed ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "v3-hint mc-overview-hint-names",
						"data-overview-names": "shadowed",
						children: namesText(catalogDiagnostics.shadowedSkills.map((item) => item.name), 4)
					}) : null,
					catalogDiagnostics !== void 0 && (catalogBroken ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "v3-hint mc-overview-hint-names",
						"data-overview-names": "broken",
						children: namesText(catalogDiagnostics.brokenPresets.map((item) => item.id), 4)
					}) : null,
					source("catalog", t("overviewCatalogSource"))
				]
			})
		]
	});
}
/**
* 本页文案（zh / en），键与 {@link OverviewKey} 一一对应。
*
* 两行「来源」小字是本页的核心交付：它们说明每个数字来自哪一层、什么时候归零，
* 这样「观察数 0」不会被读成「历史上从没调用过」，也不会被读成任何会话历史。
*/
function overviewDictionaries() {
	return {
		zh: {
			nav: "总览",
			title: "总览",
			desc: "一眼看清执行保护与能力目录的状态；数字只来自本机计数、状态文件与能力目录快照，不读聊天记录。",
			overviewRefresh: "刷新",
			overviewRefreshing: "正在读取…",
			overviewLoading: "正在读取…",
			overviewUnknown: "未知",
			overviewGuardTitle: "执行保护记录",
			overviewGuardSource: "来源：观察数与提醒/拒绝次数是执行保护的累计计数，会保存在本机，重启或更新插件都不会清零；开关与诊断来自本机状态文件。",
			overviewGuardError: "执行保护设置读取失败",
			overviewGuardObservations: "已观察调用",
			overviewGuardRepeat: "重复提醒",
			overviewGuardCycle: "循环提醒",
			overviewGuardDenials: "本地拒绝",
			overviewGuardSwitches: "开关",
			overviewGuardMaster: "总开关",
			overviewGuardDuplicate: "重复检测",
			overviewGuardCycleSwitch: "交替循环",
			overviewGuardNoProgress: "无进展保护",
			overviewSwitchOn: "已开启",
			overviewSwitchOff: "已关闭",
			overviewGuardDiag: "诊断",
			overviewGuardEffective: "已生效",
			overviewGuardNotEffective: "未生效",
			overviewDiagInvalidPatch: "配置非法",
			overviewDiagNotMounted: "未挂载",
			overviewDiagPersistenceDirty: "有未落盘改动",
			overviewDiagWriteFailed: "状态文件写入失败",
			overviewDiagNone: "无异常",
			overviewCatalogTitle: "能力菜单记录",
			overviewCatalogSource: "来源：三档计数与条目总数来自能力目录快照；版本号来自目录自身；观察时间是本页读取快照的时间。",
			overviewCatalogError: "能力目录读取失败",
			overviewCatalogResident: "常驻",
			overviewCatalogOnDemand: "按需",
			overviewCatalogDisabled: "禁用",
			overviewCatalogTotal: "条目总数",
			overviewCatalogVersion: "目录版本",
			overviewCatalogObservedAt: "本页观察时间",
			overviewCatalogTools: "工具",
			overviewCatalogSkills: "技能（全部来源）",
			overviewCatalogSkillsHint: "含项目与预设来源，可能多于能力菜单「技能」页里的全局技能。",
			overviewCatalogState: "技能目录扫描",
			overviewCatalogStateEmpty: "目录为空",
			overviewCatalogStateReady: "就绪",
			overviewCatalogStateHint: "技能目录扫描与上方能力条目是两套口径，条目数以上方「条目总数」为准。",
			overviewCatalogDiag: "诊断",
			overviewCatalogDiagUnavailable: "不可调用",
			overviewCatalogDiagShadowed: "重名",
			overviewCatalogDiagBrokenPreset: "坏预设"
		},
		en: {
			nav: "Overview",
			title: "Overview",
			desc: "Current state of the execution guard and the capability catalog; every number comes from this process counters, the guard state file and the catalog snapshot, never from session history.",
			overviewRefresh: "Refresh",
			overviewRefreshing: "Reading…",
			overviewLoading: "Reading…",
			overviewUnknown: "Unknown",
			overviewGuardTitle: "Execution protection record",
			overviewGuardSource: "Source: observation, reminder and denial counts come from the in-process Guard counters (getGuardStats; reset on restart, never backfilled); switches and diagnostics come from the Guard state file (getGuard / getGuardDiagnostics).",
			overviewGuardError: "Failed to read the guard settings",
			overviewGuardObservations: "Calls observed",
			overviewGuardRepeat: "Repeat reminders",
			overviewGuardCycle: "Cycle reminders",
			overviewGuardDenials: "Local denials",
			overviewGuardSwitches: "Switches",
			overviewGuardMaster: "Master",
			overviewGuardDuplicate: "Repeat detection",
			overviewGuardCycleSwitch: "Alternating cycles",
			overviewGuardNoProgress: "No-progress protection",
			overviewSwitchOn: "On",
			overviewSwitchOff: "Off",
			overviewGuardDiag: "Diagnostics",
			overviewGuardEffective: "Active",
			overviewGuardNotEffective: "Not in effect",
			overviewDiagInvalidPatch: "Invalid configuration",
			overviewDiagNotMounted: "Not mounted",
			overviewDiagPersistenceDirty: "Unsaved changes",
			overviewDiagWriteFailed: "State file write failed",
			overviewDiagNone: "No issues",
			overviewCatalogTitle: "Capability menu record",
			overviewCatalogSource: "Source: the three tier counts and the total come from the catalog snapshot (classifyAll); the version number comes from catalogVersion; the observation time is this page clocks reading the snapshot, not the Host refresh time; catalog diagnostics come from getDiagnostics.",
			overviewCatalogError: "Failed to read the capability catalog",
			overviewCatalogResident: "Resident",
			overviewCatalogOnDemand: "On-demand",
			overviewCatalogDisabled: "Disabled",
			overviewCatalogTotal: "Total entries",
			overviewCatalogVersion: "Catalog version",
			overviewCatalogObservedAt: "Observed at",
			overviewCatalogTools: "Tools",
			overviewCatalogSkills: "Skills (all sources)",
			overviewCatalogSkillsHint: "Includes project and preset sources, so it can exceed the global skills listed on the capability Skills tab.",
			overviewCatalogState: "Skill directory scan",
			overviewCatalogStateEmpty: "Empty",
			overviewCatalogStateReady: "Ready",
			overviewCatalogStateHint: "The skill directory scan (getDiagnostics) and the capability entries above (classifyAll) are two different measures; the entry counts above are authoritative.",
			overviewCatalogDiag: "Diagnostics",
			overviewCatalogDiagUnavailable: "Unavailable",
			overviewCatalogDiagShadowed: "Name collisions",
			overviewCatalogDiagBrokenPreset: "Broken presets"
		}
	};
}
//#endregion
//#region src/client/store.ts
/** Unwrap a RemoteResult-like, throwing a readable error on failure. */
function unwrap(result, what) {
	if (!result.ok) throw new Error(`${what} failed: ${result.error.code}: ${result.error.message}`);
	return result.value;
}
/**
* Unwrap a RemoteResult-like for a user-facing mutation.
*
* The policy service's messages are already written for the person at the
* dialog (Chinese, naming the offending path), so the RPC name and error code
* that `unwrap` adds for diagnostics are dropped here: they would surface as
* `capabilityPolicy.addSkillLocation failed: <code>: 目录中没有 SKILL.md：…`
* in a dialog that is otherwise plain Chinese.
*/
function unwrapMessage(result) {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}
/**
* The last successful snapshot, at module scope.
*
* The section is remounted every time the settings tab is opened, and a cold
* `classifyAll` can be slow while the host builds its catalog. Keeping the
* previous rows lets a remount paint them immediately and revalidate behind
* the user instead of showing a loading placeholder. This is a view cache
* only — every read is still followed by an authoritative one.
*/
let lastSnapshot;
/** Short grace period for host tools that register just after the section mounts. */
const EMPTY_SNAPSHOT_RETRY_DELAYS = [
	250,
	500,
	1e3,
	1500
];
/**
* Grace period for reloads caused by editing the MCP patch.
*
* Editing the MCP patch makes dsh hot-reload this plugin, and for the few
* seconds that takes the whole `capabilityPolicy/*` surface answers
* `gateway/service-unavailable`. The sum (9.5s) is longer than an observed
* reload (~8s).
*/
const TRANSIENT_CALL_RETRY_DELAYS = [
	500,
	1e3,
	2e3,
	3e3,
	3e3
];
/** Host failures that can clear once the reload lands. A 404 is permanent. */
function isTransientHostFailure(error) {
	const text = error instanceof Error ? error.message : String(error);
	return /gateway\/(?:service-unavailable|context-(?:unavailable|failed))\b/.test(text) || /transport failure[^\n]*HTTP (?:502|503|504)\b/.test(text);
}
/**
* Run one host call, retrying failures that can clear after a plugin reload.
*
* Anything else — a rejected write, a malformed argument — surfaces on the first
* attempt: retrying those would only delay the error the operator needs to see.
*/
async function withTransientRetry(work, retryDelays = TRANSIENT_CALL_RETRY_DELAYS) {
	for (let attempt = 0;; attempt += 1) try {
		return await work();
	} catch (error) {
		const delayMs = retryDelays[attempt];
		if (delayMs === void 0 || !isTransientHostFailure(error)) throw error;
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
}
/** The previously loaded snapshot, when this page session has one. */
function cachedSnapshot() {
	return lastSnapshot;
}
/** Read one authoritative classification list without changing the view cache. */
async function readSnapshot(remote) {
	return { rows: unwrap(await remote.classifyAll(), "capabilityPolicy.classifyAll") };
}
/** Remember a snapshot after its contents are ready to replace the current view. */
function rememberSnapshot(snapshot) {
	lastSnapshot = snapshot;
	return lastSnapshot;
}
/**
* Load the classification list, retrying an empty result briefly because
* built-in tools can register just after the settings section mounts.
* Non-empty results remain authoritative and return immediately.
*/
async function loadSnapshot(remote, retryDelays = EMPTY_SNAPSHOT_RETRY_DELAYS) {
	let snapshot = await withTransientRetry(() => readSnapshot(remote));
	for (const delayMs of retryDelays) {
		if (snapshot.rows.length > 0) break;
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		snapshot = await withTransientRetry(() => readSnapshot(remote));
	}
	return rememberSnapshot(snapshot);
}
/** Wait briefly for an MCP's tools to enter the host catalog after registration. */
async function waitForMcpTools(remote, serverName, retryDelays) {
	const prefix = `mcp__${serverName}__`;
	const hasServerTools = (snapshot) => snapshot.rows.some((row) => row.kind === "tool" && row.id.startsWith(prefix));
	let snapshot = await withTransientRetry(() => readSnapshot(remote));
	if (hasServerTools(snapshot)) return snapshot;
	for (const delayMs of retryDelays) {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		snapshot = await withTransientRetry(() => readSnapshot(remote));
		if (hasServerTools(snapshot)) return snapshot;
	}
}
//#endregion
//#region src/client/LocationModal.tsx
/**
* 能力来源弹窗：注册与编辑 MCP 服务器 / Skill 目录。
*
* Two modes, one form implementation:
*
* - **注册** — opened from the header's 注册能力 button. Carries the two
*   sub-tabs (MCP servers / skill directories) and opens on the one matching
*   the main tab the user is on, so one button is context-sensitive. No list of
*   what is already registered: that lives on the entries themselves, behind
*   the per-row 编辑 buttons, where it is actually actionable.
* - **编辑** — opened from a row's 编辑 button with the entry prefilled.
*
* Only 注册 / 保存 / 移除 are offered. Temporarily silencing a source is the
* exposure policy's job (classify the capability as Disabled), so there is no
* second enable switch here.
*/
const CSS_ID$1 = "capability-menu-location-css";
const CSS$1 = `
.lm-block{display:flex;flex-direction:column;gap:8px}
.lm-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;padding:0 10px;cursor:pointer;white-space:nowrap}
.lm-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.lm-btn--danger:hover{color:#b3261e;border-color:#b3261e}
.lm-btn:disabled{opacity:.55;cursor:default}
/* Each field is its own two-column grid with a fixed label track.
   A single form-wide grid looked tidier but was fragile: it needed
   .lm-field{display:contents}, which turned every hint into a free-floating grid
   item, and one extra half-width item pushed the following labels into column 2 and
   their inputs into column 1 — which is exactly how the streamable-http layout got
   scrambled (that branch has an odd number of items). Per-field grids mean a hint
   can only ever affect its own field, and a fixed label track (rather than
   min-width, which sizes per row) keeps every label column identical. */
.lm-form{display:flex;flex-direction:column;gap:6px}
.lm-field{--lm-label-w:104px;display:grid;grid-template-columns:var(--lm-label-w) 1fr;gap:2px 8px;align-items:start}
.lm-label{grid-column:1;min-width:0;overflow-wrap:anywhere;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
/* width:100% must come with border-box: the field carries a 1px border plus 8px of
   padding, which would otherwise overflow the column and clip. */
.lm-input{grid-column:2;width:100%;box-sizing:border-box;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12px;line-height:20px;padding:2px 8px}
.lm-input:disabled{opacity:.6}
textarea.lm-input{resize:vertical;font-family:var(--dsw-font-markdown-code-block-font-family)}
/* Lives inside its field, in the content column: it lines up with the box it
   annotates and takes the caption colour so it does not read as another label. */
.lm-hint{grid-column:2;margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.lm-error{margin:0;font-size:12px;color:#b3261e;word-break:break-word}
.lm-progress{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.lm-spinner{width:12px;height:12px;flex:none;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);border-radius:50%;animation:lm-spin .8s linear infinite}
@keyframes lm-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.lm-spinner{animation-duration:2s}}
.mc-tab:disabled,.mc-preview-close:disabled{cursor:default;opacity:.6}
.lm-actions{display:flex;gap:8px;justify-content:flex-end;padding:4px 0 0}
.lm-actions .lm-btn--remove{margin-right:auto}
/* Removal is irreversible, so it takes over the action row for one confirmation
   step: the message states the consequence, then the buttons act. */
.lm-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid #b3261e;border-radius:6px}
.lm-confirm-msg{flex:1 1 auto;margin:0;font-size:12px;line-height:18px;word-break:break-word}
.lm-confirm-actions{display:flex;gap:8px;flex-shrink:0}
/* The modal shell itself carries no padding (it is shared with the read-only
   catalog viewer, whose body supplies its own); the form supplies it here. */
.lm-body{padding:14px 16px;overflow:auto;flex:1 1 auto;min-height:0}
`;
if (typeof document !== "undefined" && document.querySelector(`style[data-css-id="${CSS_ID$1}"]`) === null) {
	const tag = document.createElement("style");
	tag.dataset.cssId = CSS_ID$1;
	tag.textContent = CSS$1;
	document.head.appendChild(tag);
}
/** Render a key/value map as `Key: Value` lines. */
function toLines(record) {
	if (record === void 0) return "";
	return Object.entries(record).map(([key, value]) => `${key}: ${value}`).join("\n");
}
/** Parse `Key: Value` lines into a map; blank lines and lines without `:` are skipped. */
function fromLines(text) {
	const out = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const at = trimmed.indexOf(":");
		if (at <= 0) continue;
		const key = trimmed.slice(0, at).trim();
		const value = trimmed.slice(at + 1).trim();
		if (key.length > 0) out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : void 0;
}
function LocationModal(props) {
	const { remote, t, defaultKind = "mcp", editMcp, editSkill, onClose, onChanged } = props;
	const editing = editMcp !== void 0 || editSkill !== void 0;
	const [subTab, setSubTab] = (0, react.useState)(editSkill !== void 0 ? "skill" : editMcp !== void 0 ? "mcp" : defaultKind);
	const [errors, setErrors] = (0, react.useState)({});
	const [busy, setBusy] = (0, react.useState)(false);
	const [progressMessage, setProgressMessage] = (0, react.useState)(null);
	/**
	* Which action is waiting for confirmation, if any. Two need one: 移除, and
	* 保存 on an entry that is a real directory — repointing unlinks the entry
	* first, which recursively deletes a real directory's contents.
	*/
	const [confirm, setConfirm] = (0, react.useState)(null);
	const [serverName, setServerName] = (0, react.useState)(editMcp?.serverName ?? "");
	const [transport, setTransport] = (0, react.useState)(editMcp?.transport ?? "streamable-http");
	const [command, setCommand] = (0, react.useState)(editMcp?.command ?? "");
	const [args, setArgs] = (0, react.useState)((editMcp?.args ?? []).join(" "));
	const [cwd, setCwd] = (0, react.useState)(editMcp?.cwd ?? "");
	const [env, setEnv] = (0, react.useState)(toLines(editMcp?.env));
	const [url, setUrl] = (0, react.useState)(editMcp?.url ?? "");
	const [headers, setHeaders] = (0, react.useState)(toLines(editMcp?.headers));
	const [timeoutSec, setTimeoutSec] = (0, react.useState)(editMcp?.toolCallTimeoutMs === void 0 ? "" : String(Math.round(editMcp.toolCallTimeoutMs / 1e3)));
	const [skillDir, setSkillDir] = (0, react.useState)(editSkill?.target ?? editSkill?.path ?? "");
	const [skillRoot, setSkillRoot] = (0, react.useState)(editSkill?.root ?? "user");
	/** A path inside the project; the server derives the project root from it. */
	const [projectPath, setProjectPath] = (0, react.useState)("");
	/**
	* What the operator sees this entry called. They got here from a row named by
	* the skill's declared name, so the messages use that and not the entry's own
	* name — which is only ever handed back to the server, since that is what
	* addresses the symlink on disk.
	*/
	const skillLabel = editSkill?.skillName ?? editSkill?.name ?? "";
	const title = (0, react.useMemo)(() => {
		if (editMcp !== void 0) return t("editMcp");
		if (editSkill !== void 0) return t("editSkillNamed", { name: skillLabel });
		return t("registerCapability");
	}, [
		editMcp,
		editSkill,
		skillLabel,
		t
	]);
	/** Run a mutation; on success close and ask the parent to re-pull. */
	const submit = (0, react.useCallback)(async (action, noticeFor, progress, registeredMcp) => {
		if (busy) return;
		setBusy(true);
		setProgressMessage(progress ?? null);
		setErrors((prev) => {
			const next = { ...prev };
			delete next[subTab];
			return next;
		});
		try {
			const changed = await action();
			if (changed === false) throw new Error(t("entryNotFound"));
			setErrors((prev) => {
				const next = { ...prev };
				delete next[subTab];
				return next;
			});
			onChanged(noticeFor?.(changed), registeredMcp);
			onClose();
		} catch (e) {
			setErrors((prev) => ({
				...prev,
				[subTab]: String(e)
			}));
		} finally {
			setBusy(false);
			setProgressMessage(null);
		}
	}, [
		busy,
		onChanged,
		onClose,
		subTab,
		t
	]);
	const submitMcp = (0, react.useCallback)(() => {
		const trimmedTimeout = timeoutSec.trim();
		const timeoutMs = trimmedTimeout.length === 0 ? void 0 : Math.round(Number(trimmedTimeout) * 1e3);
		if (timeoutMs !== void 0 && !Number.isFinite(timeoutMs)) {
			setErrors((prev) => ({
				...prev,
				mcp: t("timeoutInvalid")
			}));
			return;
		}
		const parsedEnv = fromLines(env);
		const parsedHeaders = fromLines(headers);
		const common = {
			transport,
			...transport === "stdio" ? {
				command: command.trim(),
				...args.trim().length > 0 ? { args: args.trim().split(/\s+/) } : {},
				...parsedEnv !== void 0 ? { env: parsedEnv } : {},
				...cwd.trim().length > 0 ? { cwd: cwd.trim() } : {}
			} : {
				url: url.trim(),
				...parsedHeaders !== void 0 ? { headers: parsedHeaders } : {}
			},
			...timeoutMs !== void 0 ? { toolCallTimeoutMs: timeoutMs } : {}
		};
		submit(async () => editMcp !== void 0 ? unwrapMessage(await remote.updateLocation(editMcp.id, common)) : unwrapMessage(await remote.addLocation({
			serverName: serverName.trim(),
			...common
		})), void 0, void 0, editMcp?.serverName ?? serverName.trim());
	}, [
		submit,
		remote,
		editMcp,
		serverName,
		transport,
		command,
		args,
		cwd,
		env,
		url,
		headers,
		timeoutSec,
		t
	]);
	const submitSkill = (0, react.useCallback)(() => {
		const source = skillDir.trim();
		const asked = skillRoot === "project" ? projectPath.trim() : void 0;
		submit(async () => {
			if (editSkill !== void 0) return unwrapMessage(await remote.updateSkillLocation(editSkill.name, source, editSkill.entryDir));
			if (/^https?:\/\//i.test(source)) return unwrapMessage(await remote.importSkillFromGitHub(source, asked));
			return unwrapMessage(await remote.addSkillLocation(source, asked));
		}, (result) => editSkill !== void 0 ? t("skillRepointed", { dir: source }) : t("skillRegisteredAt", { path: String(result) }), editSkill === void 0 && /^https:\/\//i.test(source) ? t("githubImporting") : void 0);
	}, [
		submit,
		remote,
		editSkill,
		skillDir,
		skillRoot,
		projectPath,
		t
	]);
	const remove = (0, react.useCallback)(() => {
		if (editMcp !== void 0) {
			submit(async () => unwrapMessage(await remote.removeLocation(editMcp.id)));
			return;
		}
		if (editSkill !== void 0) submit(async () => unwrapMessage(await remote.removeSkillLocation(editSkill.name, editSkill.entryDir)));
	}, [
		submit,
		remote,
		editMcp,
		editSkill
	]);
	/**
	* What removal actually costs, which differs by target: an MCP row only loses
	* its config, a linked skill only loses its symlink — but `removeSkill`
	* recursively deletes a *real* directory in the skill root, so that case has to
	* say so before the click, not after.
	*/
	const removalWarning = (0, react.useMemo)(() => {
		if (editMcp !== void 0) return t("confirmRemoveMcp", { name: editMcp.serverName });
		if (editSkill === void 0) return "";
		return editSkill.linked ? t("confirmRemoveSkillLink", { name: skillLabel }) : t("confirmRemoveSkillDir", { name: skillLabel });
	}, [
		editMcp,
		editSkill,
		skillLabel,
		t
	]);
	/** Saving needs a confirmation only when it would delete a real directory. */
	const needsSaveConfirm = editSkill !== void 0 && !editSkill.linked;
	/** The action row, or the confirmation step that has replaced it. */
	const renderActions = (onSubmit) => confirm !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "lm-confirm",
		role: "alert",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			className: "lm-confirm-msg",
			children: confirm === "save" ? t("saveConfirmRealDir", { name: skillLabel }) : removalWarning
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "lm-confirm-actions",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "lm-btn",
				disabled: busy,
				onClick: () => setConfirm(null),
				children: t("cancel")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "lm-btn lm-btn--danger",
				disabled: busy,
				onClick: () => {
					if (confirm === "save") onSubmit();
					else remove();
				},
				children: confirm === "save" ? t("confirmSaveAnyway") : t("confirmRemove")
			})]
		})]
	}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "lm-actions",
		children: [editing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: "lm-btn lm-btn--danger lm-btn--remove",
			disabled: busy,
			onClick: () => setConfirm("remove"),
			children: t("remove")
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: "lm-btn",
			disabled: busy,
			onClick: () => {
				if (needsSaveConfirm) setConfirm("save");
				else onSubmit();
			},
			children: progressMessage !== null ? t("importing") : editing ? t("save") : t("register")
		})]
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "mc-preview-mask",
		onClick: busy ? void 0 : onClose,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "mc-preview",
			onClick: (e) => e.stopPropagation(),
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "mc-preview-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "mc-preview-title",
						children: title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "mc-preview-close",
						disabled: busy,
						onClick: onClose,
						children: t("previewClose")
					})]
				}),
				!editing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "mc-subtabs mc-catalog-tabs",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-tab-group",
						role: "tablist",
						"aria-label": t("registerCapability"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							className: "mc-tab",
							"aria-selected": subTab === "mcp",
							"data-active": subTab === "mcp" ? "true" : void 0,
							disabled: busy,
							onClick: () => setSubTab("mcp"),
							children: t("mcpServers")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							className: "mc-tab",
							"aria-selected": subTab === "skill",
							"data-active": subTab === "skill" ? "true" : void 0,
							disabled: busy,
							onClick: () => setSubTab("skill"),
							children: t("skillDirs")
						})]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "lm-body",
					children: [
						errors[subTab] !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "lm-error",
							children: errors[subTab]
						}),
						progressMessage !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "lm-progress",
							role: "status",
							"aria-live": "polite",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "lm-spinner",
								"aria-hidden": "true"
							}), progressMessage]
						}),
						subTab === "mcp" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "lm-block",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "lm-form",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "lm-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("transport")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												className: "lm-input",
												value: transport,
												onChange: (e) => setTransport(e.target.value === "stdio" ? "stdio" : "streamable-http"),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "stdio",
													children: t("transportStdio")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "streamable-http",
													children: t("transportHttp")
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "lm-hint",
												children: transport === "stdio" ? t("transportHintStdio") : t("transportHintHttp")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "lm-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("serverName")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "lm-input",
												value: serverName,
												disabled: editMcp !== void 0,
												onChange: (e) => setServerName(e.target.value)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "lm-hint",
												children: t("serverNameImmutable")
											})
										]
									}),
									transport === "stdio" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "lm-field",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("command")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "lm-input",
												value: command,
												onChange: (e) => setCommand(e.target.value)
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "lm-field",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("args")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "lm-input",
												value: args,
												onChange: (e) => setArgs(e.target.value)
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "lm-field",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("cwd")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "lm-input",
												value: cwd,
												onChange: (e) => setCwd(e.target.value)
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "lm-field",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("env")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												className: "lm-input",
												rows: 3,
												value: env,
												onChange: (e) => setEnv(e.target.value)
											})]
										})
									] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "lm-field",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "lm-label",
											children: t("url")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "lm-input",
											value: url,
											onChange: (e) => setUrl(e.target.value)
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "lm-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("headers")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												className: "lm-input",
												rows: 4,
												value: headers,
												onChange: (e) => setHeaders(e.target.value)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "lm-hint",
												children: t("headersHint")
											})
										]
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "lm-field",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "lm-label",
											children: t("timeout")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "lm-input",
											value: timeoutSec,
											placeholder: "60",
											onChange: (e) => setTimeoutSec(e.target.value)
										})]
									}),
									renderActions(() => void submitMcp())
								]
							})
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "lm-block",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "lm-form",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "lm-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("skillRoot")
											}),
											editSkill !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "lm-input",
												value: t(editSkill.root === "project" ? "skillRootProject" : "skillRootUser"),
												disabled: true
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												className: "lm-input",
												value: skillRoot,
												onChange: (e) => setSkillRoot(e.target.value === "project" ? "project" : "user"),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "user",
													children: t("skillRootUser")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "project",
													children: t("skillRootProject")
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "lm-hint",
												children: skillRoot === "project" || editSkill?.root === "project" ? t("skillRootHintProject") : t("skillRootHintUser")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "lm-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("skillDirPath")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "lm-input",
												value: skillDir,
												onChange: (e) => setSkillDir(e.target.value)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "lm-hint",
												children: t("skillDirHint")
											})
										]
									}),
									editSkill === void 0 && skillRoot === "project" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "lm-field",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "lm-label",
												children: t("skillProjectPath")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "lm-input",
												value: projectPath,
												onChange: (e) => setProjectPath(e.target.value)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "lm-hint",
												children: t("skillProjectPathHint")
											})
										]
									}),
									renderActions(() => void submitSkill())
								]
							})
						})
					]
				})
			]
		})
	});
}
/**
* dsh's source labels for a project's own skill roots — the `project`-prefixed
* providers of `@deepseek-ai/dsh-skill-filesystem`, which scan
* `<projectRoot>/.dsh/skills` and `<projectRoot>/.agents/skills`. Every other
* label (`user-dsh`, `user-agents`, `bundled`, `custom`, `runtime`) is a
* user-level root. Shared so the server's location manager and the browser's
* 全局 / 项目 grouping agree on what "project scoped" means.
*/
const PROJECT_SKILL_SOURCES = /* @__PURE__ */ new Set(["project-dsh", "project-agents"]);
/**
* Source labels for user-level skill roots whose entries this plugin can adopt:
* linking the skill's own directory into the user root (where the entry becomes
* editable) without touching its content. `user-dsh` is excluded because that
* root is already managed, and `bundled` because a packaged skill should not be
* shadowed by a user copy.
*/
const ADOPTABLE_SKILL_SOURCES = /* @__PURE__ */ new Set(["user-agents", "custom"]);
//#endregion
//#region src/client/skillGroups.ts
/**
* What the capability list decides about *which* rows it shows, kept out of
* `CapabilitySection.tsx` as pure functions.
*
* The split is deliberate: the grouping rules are where this plugin got its one
* real mis-grouping (preset skills filed under 全局技能), and they are also the
* only part of the client a test can reach — this repo has no DOM harness, so
* anything that lives inside the component can only be checked by hand.
*/
/** Group tools by server name; skills stay flat (no server), both name-sorted. */
function groupRows(rows) {
	const byServer = /* @__PURE__ */ new Map();
	const skills = [];
	for (const row of rows) {
		if (row.kind === "skill") {
			skills.push(row);
			continue;
		}
		const server = row.server ?? "built-in";
		const list = byServer.get(server);
		if (list === void 0) byServer.set(server, [row]);
		else list.push(row);
	}
	return {
		servers: [...byServer.entries()].map(([server, tools]) => ({
			server,
			tools: [...tools].sort((a, b) => a.name.localeCompare(b.name))
		})).sort((a, b) => a.server.localeCompare(b.server)),
		skills: [...skills].sort((a, b) => a.name.localeCompare(b.name))
	};
}
/**
* Compile the box. A `/…/` wrapper is optional — it is stripped when present, so
* both `cordis|ptc` and `/cordis|ptc/` are read as patterns — and it keeps the
* common case of pasting a slash-delimited pattern from working.
*/
function compileNameFilter(input) {
	const raw = input.trim();
	const needle = raw.toLowerCase();
	if (raw === "") return {
		needle,
		regex: false,
		test: () => true
	};
	const pattern = raw.length > 1 && raw.startsWith("/") && raw.endsWith("/") ? raw.slice(1, -1) : raw;
	try {
		const compiled = new RegExp(pattern, "i");
		return {
			needle,
			regex: true,
			test: (values) => values.some((v) => v !== void 0 && compiled.test(v))
		};
	} catch {
		return {
			needle,
			regex: false,
			test: (values) => values.some((v) => v !== void 0 && v.toLowerCase().includes(needle))
		};
	}
}
/**
* Everything a row is matched against: its own name, plus the dimensions that
* name the group it sits in — the MCP server (or the label the built-in group is
* drawn with), the skill's source root, and the preset that ships it.
*
* Group headings are labels rather than row fields, which is exactly why typing
* 系统 used to find nothing: the server id is `built-in`, and 系统内置 is only how
* that id is painted. Both spellings are searchable now.
*/
function searchableText(row, labels = {}) {
	const values = [row.name];
	if (row.server !== void 0) {
		values.push(row.server);
		if (row.server === "built-in") values.push(labels.builtIn);
	}
	if (row.source !== void 0) values.push(row.source, labels.source?.(row.source));
	values.push(row.preset);
	return values.filter((v) => v !== void 0 && v !== "");
}
/**
* Narrow a list by the filter. Applied *before* grouping so a server header's
* own counts describe the rows actually listed under it.
*/
function filterRows(rows, filter, labels = {}) {
	if (filter.needle === "") return [...rows];
	return rows.filter((row) => filter.test(searchableText(row, labels)));
}
/**
* Split skill rows across the three sub-tabs.
*
* Preset skills are split off by their `preset` field and never by `source`: a
* preset's own `skill-filesystem` labels its skills `custom`, exactly like a
* user-configured `customSkillDirs` entry, so a source-based rule drags both
* into 全局技能 — filing a preset asset as global is precisely the mis-grouping
* this split exists to fix. Rows keep the order they arrive in, so callers that
* pass name-sorted rows get name-sorted groups.
*/
function splitSkillGroups(skills) {
	const presetSkills = [];
	const projectSkills = [];
	const globalSkills = [];
	const presetGroups = [];
	for (const skill of skills) {
		const preset = skill.preset;
		if (preset !== void 0) {
			presetSkills.push(skill);
			const group = presetGroups.find(([id]) => id === preset);
			if (group === void 0) presetGroups.push([preset, [skill]]);
			else group[1].push(skill);
			continue;
		}
		if (PROJECT_SKILL_SOURCES.has(skill.source ?? "")) projectSkills.push(skill);
		else globalSkills.push(skill);
	}
	presetGroups.sort(([a], [b]) => a.localeCompare(b));
	return {
		presetSkills,
		presetGroups,
		projectSkills,
		globalSkills
	};
}
/** Rows in one tier. Counts the *displayed* rows, not the whole catalog. */
function countByClass(rows, cls) {
	return rows.reduce((n, row) => row.class === cls ? n + 1 : n, 0);
}
//#endregion
//#region src/client/revalidate.ts
/**
* When to re-read the catalog, and how often to look — the decisions behind the
* management page keeping itself fresh, kept as pure functions.
*
* Wiring lives in `CapabilitySection.tsx` (timers, the `visibilitychange`
* listener, the two subscriptions); everything that could be got wrong lives
* here, where a test can reach it. This repo has no DOM harness.
*/
/**
* How often a visible, idle page asks the host for its catalog version.
*
* This is the resolution of the one case nothing on the wire announces — a file
* dropped into an already-registered skill directory — so it doubles as "how
* long will I stare at a stale list after an agent changes something next to
* me". 5s keeps that from being annoying; the cost is one tiny request per tick,
* and only while this settings page is on screen.
*/
const POLL_INTERVAL_MS = 5e3;
/** Ceiling for the failure backoff, so a long outage does not spin. */
const POLL_BACKOFF_MAX_MS = 6e4;
/**
* How long one version sample may take before it is treated as a failure.
*
* Without this, a request that neither resolves nor rejects would end the poll
* for good: the next tick is only scheduled after the current one settles, and
* nothing else restarts the effect while the page stays visible and idle.
*/
const POLL_SAMPLE_TIMEOUT_MS = 15e3;
/**
* Delay before the next version poll.
*
* `failures` is the run of consecutive failures ending at this decision: 0
* means the last sample succeeded and the plain interval applies, otherwise the
* delay doubles until it hits the ceiling. This is what turns "the carrier
* died" from a hot loop into a slow retry that heals itself when it comes back.
*/
function pollDelayMs(failures) {
	if (!Number.isFinite(failures) || failures <= 0) return POLL_INTERVAL_MS;
	return Math.min(POLL_INTERVAL_MS * 2 ** failures, POLL_BACKOFF_MAX_MS);
}
/**
* Whether a version sample means the catalog moved under the page.
*
* Deliberately `!==` rather than `>`: the counter is in-process, so it restarts
* from zero when the plugin reloads, and a plain "greater than" test would sit
* there believing a fresh host was the same host. `undefined` (nothing sampled
* yet) only records — the page has just read the snapshot, and re-reading it
* because it has no baseline would be busywork.
*/
function versionChanged(seen, current) {
	return seen !== void 0 && seen !== current;
}
/**
* The value of `work`, or a rejection if it has not settled within `ms`.
*
* Used so a carrier that accepts a request and then goes quiet degrades into
* the same retry path as a carrier that refuses one.
*/
function withDeadline(work, ms) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(/* @__PURE__ */ new Error(`timed out after ${ms}ms`)), ms);
		work.then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}
/** Whether a signal may act now, or has to be parked until the page is idle. */
function canRevalidate(gate) {
	return gate.visible && gate.ready && !gate.busy && !gate.rebuilding;
}
//#endregion
//#region src/client/capability-v3/view-model.ts
/**
* 能力菜单 v3 · 档位切换的数据层。
*
* WHY THIS MODULE: 上游 0.2.0 的 `capabilityPolicy` 远程面没有 0.1.27 里的
* `moveCapabilities` 意图接口，只有 `getConfig()` / `updateConfig(partial)`
* 这对整表读写。页面需要「把某些 id 移到某一档」，于是把它收成一个纯函数加
* 一次远程往返：语义与上游 `CapabilitySection.tsx` 里那段循环切换逐行等价
* （读该 kind 的三档列表 → 从三档全部摘掉 → 追加进目标档 → 只回写该 kind），
* 但抽成可单测的纯函数，免得每个调用点各写一遍整表重建。
*
* 一个必须保留的既有行为：服务端分类器里通配规则（`mcp__x__*`）与
* `server:<name>` 规则的优先级高于我们刚写入的单条精确规则，因此「写了却没
* 生效」是可能发生的。{@link overriddenIds} 让页面回读快照后把这种情况说出来，
* 而不是静默显示一个没动过的档位。
*/
/** 档位机器值，与 `src/policy.ts` 的 `CapabilityClass` 一致。 */
const TIERS = [
	"resident",
	"on-demand",
	"disabled"
];
/** 点击循环顺序：常驻 → 按需 → 禁用 → 常驻（沿用 0.1.27 的 NEXT_CLASS）。 */
const NEXT_TIER = {
	resident: "on-demand",
	"on-demand": "disabled",
	disabled: "resident"
};
/** 下一档；档位标签点击后的目标。 */
function nextTier(current) {
	return NEXT_TIER[current];
}
/** `getConfig()` 返回对象里该 kind 对应的顶层键。 */
function configKeyFor(kind) {
	return kind === "skill" ? "skills" : "tools";
}
/**
* 把 `getConfig()` 里的未知值收成三档字符串数组。
*
* 远程面把 config 声明为 `Record<string, unknown>`，所以这里必须真校验：一份
* 被手写坏掉的配置（某档写成字符串、含非字符串项）只会丢掉那一档的坏项，
* 不该让整次点击抛错。
*/
function readTierLists(set) {
	const record = set !== null && typeof set === "object" && !Array.isArray(set) ? set : {};
	const lists = {
		resident: [],
		"on-demand": [],
		disabled: []
	};
	for (const tier of TIERS) {
		const raw = record[tier];
		lists[tier] = Array.isArray(raw) ? raw.filter((entry) => typeof entry === "string") : [];
	}
	return lists;
}
/**
* 把 `ids` 移到 `target` 档：先从三档里全部摘掉，再追加到目标档末尾。
*
* 其余规则保持原顺序。顺序不影响分类结果（分类器按档位优先级判定），但保序让
* 「查看目录」弹窗里的规则列表稳定可读，也让磁盘 diff 只包含真正移动的那几行。
* 重复 id 先去重，避免一次点击把同一个名字写进列表两次。
*/
function moveIdsIntoTier(lists, ids, target) {
	const wanted = [...new Set(ids)];
	const wantedSet = new Set(wanted);
	const next = {
		resident: [],
		"on-demand": [],
		disabled: []
	};
	for (const tier of TIERS) next[tier] = lists[tier].filter((entry) => !wantedSet.has(entry));
	next[target] = [...next[target], ...wanted];
	return next;
}
/**
* 移动没有生效的 id：回读快照后 class 仍不是 `target` 的那些。
*
* 用于「分类未生效：N 个能力被更高优先级规则覆盖」这句提示——通配规则或
* `server:<name>` 规则会盖过刚写入的精确规则，静默会让人以为点击丢了。
*/
function overriddenIds(ids, target, rows) {
	return ids.filter((id) => rows.find((row) => row.id === id)?.class !== target);
}
/**
* 把一组 id 移到目标档，返回实际写回的三档列表。
*
* 读-改-写是一次远程往返，窗口期压到「读后立即写」：上游没有意图级接口，无法
* 做到服务端原子，另一窗口在同一瞬间的并发移动可能被这次回写覆盖（与上游自己
* 的整表写入是同一取舍）。写入失败原样抛出——服务端会先校验再提交，例如把
* `meta_search` 移出常驻会被 fail-loud 拒绝，那属于要显示给操作者的错误，不能
* 被误读成「被规则覆盖」。
*/
async function moveCapabilities(remote, request) {
	const { kind, ids, target } = request;
	const key = configKeyFor(kind);
	const lists = moveIdsIntoTier(readTierLists((await withTransientRetry(async () => unwrap(await remote.getConfig(), "capabilityPolicy.getConfig")))[key]), ids, target);
	unwrap(await remote.updateConfig({ [key]: lists }), "capabilityPolicy.updateConfig");
	return lists;
}
//#endregion
//#region src/client/capability-v3/section.tsx
/**
* 能力菜单 v3 —— 独立视图（移植自本项目 0.1.27 的 CapabilitySection.tsx）。
*
* WHY A SEPARATE PAGE: 上游 `src/client/CapabilitySection.tsx` 是本分支的硬
* 约束（一字不改），所以 v3 页面不覆盖它，而是在 `capability-v3/` 里独立成页，
* 由 `src/client/index.ts` 单独注册。数据面仍是上游的 `capabilityPolicy` 远程
* 面：类型来自 `../store.ts`，Typert 定义来自 `../remote.ts`。
*
* 与 0.1.27 的差异恰好三处，都在移植时逐条改过：
*   1. 档位切换改走 `./view-model.ts`（上游没有 `moveCapabilities` 意图接口，
*      用 `getConfig`/`updateConfig` 整表实现，语义与上游同名逻辑一致）；
*   2. 删除调用统计子系统（已移除），连同「N 次 / 失败 N」单元格
*      与四档计数条里的「零调用」格；
*   3. `t` 的键集裁到本页真正用到的部分，不再携带 0.1.27 四页签外壳的键。
*
* 另外新增一处行为：档位切换在**回读确认**后给出可见反馈（`cycleSaved`：已保存
* 某某 → 某档），失败或被规则覆盖时仍走原有的「分类未生效」提示，二者共用同一个
* Toast 槽位，连点不会堆叠。
*
* 原 0.1.27 文件头（保留历史语境）：
* React section for the Capability Menu settings tab. Tools and Skills share
* one heading; each capability has a clickable exposure tier.
*
* Layout:
*   - tier counts     → counts for the active Tools or Skills source tab
*   - tabs            → Tools | Skills (plugins-tab chrome)
*   - Tools tab       → grouped by server, collapsible disclosure rows; the
*                       per-class count chip and each tool's class chip are
*                       clickable to cycle Resident → On-demand → Disabled.
*                       Harness-native tools (no real MCP server) share the
*                       reserved `built-in` group, shown as 「系统内置」.
*   - Skills tab      → sub-tabs 全局技能 / 项目技能 / 预设技能, each
*                       with flat skill rows carrying the same clickable class
*                       chip plus a directory tree / file preview
*/
const chevronIcons = _deepseek_ai_dsh_client_ui_primitives;
const IconTriangleRightFill = chevronIcons.IconTriangleRightFillMedium ?? chevronIcons.IconTriangleRightFill14;
const CLASS_KEYS = [
	"resident",
	"on-demand",
	"disabled"
];
/** i18n keys for the short display labels, keyed by the machine class value. */
const CLASS_SHORT_KEYS = {
	resident: "residentShort",
	"on-demand": "onDemandShort",
	disabled: "disabledShort"
};
/** Scoped stylesheet: injected once at module scope, like every official bundle. */
const CSS_ID = "capability-menu-section-css";
const CSS = `
.mc-section{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}
/* One settings page with category tabs on top (PluginSection). The reused
   views keep .mc-section; only the chrome wrapping them is new. */
.mc-plugin-section{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--dsw-alias-label-primary)}
.mc-plugin-section>.mc-tabs{padding-bottom:0}
.mc-plugin-section>.mc-panel{padding-top:0}
.mc-heading{margin:0;font-size:18px;font-weight:600}
.mc-heading-row{display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:wrap}
.mc-heading-meta{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.mc-heading-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-left:auto;min-width:0}
.mc-feedback-link{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;white-space:nowrap;text-decoration:none}
.mc-feedback-link:hover,.mc-feedback-link:focus-visible{color:#527a9c;text-decoration:underline;text-underline-offset:3px}
.mc-feedback-link:focus-visible{outline:2px solid #527a9c;outline-offset:2px;border-radius:2px}
body[data-ds-dark-theme] .mc-feedback-link:hover,body[data-ds-dark-theme] .mc-feedback-link:focus-visible{color:#96b6d1}
body[data-ds-dark-theme] .mc-feedback-link:focus-visible{outline-color:#96b6d1}
.mc-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px}
@media(max-width:640px){.mc-heading-actions{width:100%;justify-content:flex-start;margin-left:0}}
.mc-version{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;white-space:nowrap}
.mc-update-check{flex:none;white-space:nowrap}
.mc-update-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}
.mc-update-dialog{width:min(500px,calc(100vw - 48px))}
.mc-update-actions{flex-wrap:wrap}
.mc-update-actions .mc-update-cancel{margin-right:auto}
.mc-update-steps{display:flex;flex-direction:column;gap:8px}
.mc-update-steps pre{margin:0;padding:10px 12px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;white-space:pre-wrap;word-break:break-all}
.mc-summary{display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end;align-items:center;padding-bottom:8px}
/* 忙碌态靠变淡表示，而不是换文案：换文案会改按钮宽度，把这行挤到第二行。 */
.mc-catalog-tabs{padding:8px 16px 0}
.mc-catalog-toolbar{display:flex;align-items:center;gap:12px;padding:8px 16px 0;min-width:0}
.mc-catalog-toolbar .mc-catalog-path{flex:1 1 auto;min-width:0;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-summary-setting{display:flex;align-items:center;gap:8px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}
.mc-summary-setting input{box-sizing:border-box;width:76px;padding:4px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
.mc-catalog-limit-error{padding:4px 16px 0;margin:0;font-size:12px}
@media(max-width:600px){.mc-catalog-toolbar{flex-wrap:wrap}.mc-catalog-toolbar .mc-catalog-path{flex-basis:100%}.mc-summary-setting{flex-wrap:wrap;justify-content:flex-end;margin-left:auto}}
.mc-catalog-path{padding:8px 16px 0;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.mc-search-result{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mc-search-result:first-child{padding-top:0}
.mc-search-result:last-child{border-bottom:0}
.mc-search-result-head{display:flex;align-items:center;gap:8px;font-size:12px;line-height:20px}
.mc-search-result-id{font-family:var(--dsw-font-markdown-code-block-font-family);overflow-wrap:anywhere}
.mc-search-result-summary{margin:4px 0 0;font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.mc-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:20px;white-space:nowrap}
/* 三态圆点：常驻=实心、按需=半实心、禁用=圆环+斜杠（禁行标志）。
   形状区分之外仍保留色盲友好（蓝-黄轴）：冷蓝=常驻、暖琥珀=按需、中性灰=禁用。
   三个状态都用内联 SVG 做 mask 绘制，保证 10px 下也是矢量正圆（避免 CSS
   border-radius 小尺寸的方圆变形）；禁用不用空心圆：在「禁用 · 0」这类计数旁，
   空心圆容易被误读成数字 0。 */
.mc-dot{position:relative;width:13px;height:13px;border-radius:50%;flex:none;box-sizing:border-box}
.mc-dot--resident{--mc-dot:#527a9c;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='5.3' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='5.3' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat}
.mc-dot--on-demand{--mc-dot:#a57c33;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cpath d='M1.4 6 A4.6 4.6 0 0 1 10.6 6 Z' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cpath d='M1.4 6 A4.6 4.6 0 0 1 10.6 6 Z' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat}
.mc-dot--disabled{--mc-dot:#7e7477;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cline x1='3' y1='9' x2='9' y2='3' stroke='%23000' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cline x1='3' y1='9' x2='9' y2='3' stroke='%23000' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat}
body[data-ds-dark-theme] .mc-dot--resident{--mc-dot:#96b6d1}
body[data-ds-dark-theme] .mc-dot--on-demand{--mc-dot:#d4b26b}
body[data-ds-dark-theme] .mc-dot--disabled{--mc-dot:#b8abad}
/* 同上色系（低饱和灰调）：仅文字着色，不加背景，浅/深主题各一档。 */
.mc-chip--resident{color:#527a9c}
.mc-chip--on-demand{color:#a57c33}
.mc-chip--disabled{color:#7e7477}
body[data-ds-dark-theme] .mc-chip--resident{color:#96b6d1}
body[data-ds-dark-theme] .mc-chip--on-demand{color:#d4b26b}
body[data-ds-dark-theme] .mc-chip--disabled{color:#b8abad}
.mc-tabs{border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;align-items:flex-end;justify-content:space-between;gap:22px}
/* 名字过滤框：两个 tab 共用一条，宽度占满，与下方列表左对齐。
   它属于上面的主 tab 栏，不属于下面的列表，所以两侧都把 .mc-section 的 12px
   栏距收掉一部分：下划线—6px—输入框—8px—全局/项目 子页签文字（后者里的 4px
   是子页签自己的 padding-top）。改之前是 12+12=24px 和 12+4=16px，读起来像
   两个不相干的块。 */
.mc-filter{display:flex;padding-top:0;margin-top:-6px;margin-bottom:-8px}
.mc-filter input{box-sizing:border-box;width:100%;min-width:0;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px;line-height:18px}
.mc-filter input:hover{border-color:var(--dsw-alias-border-l3)}
.mc-filter input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:transparent}
/* Skills source tabs (global/project/preset): same underline chrome, no right-side summary. */
.mc-subtabs{border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;align-items:flex-end;gap:22px}
.mc-tab-group{display:flex;align-items:flex-end;gap:22px}
.mc-tab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}
.mc-tab:hover,.mc-tab[data-active=true]{color:var(--dsw-alias-label-primary)}
.mc-tab[data-active=true]:after,.mc-tab:focus-visible:after{background:var(--dsw-alias-label-primary);content:"";border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}
.mc-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;color:var(--dsw-alias-label-primary);border-radius:2px}
/* 面板的第一行必须和另一个 tab 的第一行从过滤框下沿出发走同样远，否则切 tab 时
   首行会跳一下。这里留 4px，加上 .mc-section 的 4px 栏距（过滤框那侧被 -8px 收
   掉后剩 4px）= 8px，正好是 Skills 面板子页签文字的位置（4px 栏距 + 子页签自己
   的 4px padding-top）。原来这里是 12px，Tools 的首个分组因此落在过滤框下 16px
   处，比「全局技能」那行低一半。 */
.mc-panel{min-width:0;padding-top:4px}
/* Skills panel: its first row is the source sub-tab bar, and that bar
   belongs to the header stack above it (rule → name filter → sub-tabs) rather
   than to the list below. So the panel adds no padding of its own, and the
   sub-tab labels keep a 4px top padding instead of the 7px they share with the
   primary tabs. */
.mc-panel--tight{padding-top:0}
.mc-panel--tight .mc-subtabs .mc-tab{padding-top:4px}
.mc-panel-inner{display:flex;flex-direction:column;gap:14px}
.mc-group{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.mc-group-header{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mc-group-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-group-header:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.mc-chevron{color:var(--dsw-alias-label-tertiary);transition:transform .15s ease;flex:none}
.mc-chevron--open{transform:rotate(90deg)}
.mc-server-name{font-weight:600;font-size:14px;line-height:20px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-server-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:none}
.mc-server-meta{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none;min-width:0}
.mc-counts{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}
.mc-count{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:1px solid transparent;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.mc-count:hover{border-color:var(--dsw-alias-border-l3)}
.mc-count:disabled{cursor:default;opacity:.6}
.mc-count--resident{color:#527a9c}
.mc-count--on-demand{color:#a57c33}
.mc-count--disabled{color:#7e7477}
body[data-ds-dark-theme] .mc-count--resident{color:#96b6d1}
body[data-ds-dark-theme] .mc-count--on-demand{color:#d4b26b}
body[data-ds-dark-theme] .mc-count--disabled{color:#b8abad}
/* 「编辑」是动作，不是分类计数：沿用 chip 的尺寸以对齐，但用次要文字色、hover
   才变蓝加下划线。裸用 .mc-count 时会继承 .mc-section 的 label-primary（浅色
   主题下近黑），夹在着色的计数 chip 旁会读成一枚没有圆点的黑色 chip。 */
.mc-count--action{color:var(--dsw-alias-label-secondary)}
.mc-count--action:hover{color:var(--dsw-alias-state-business-primary);text-decoration:underline}
.mc-tools{border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.mc-tool{box-sizing:border-box;display:flex;align-items:center;flex-wrap:wrap;gap:10px;width:100%;min-width:0;padding:7px 12px 7px 26px;font-size:13px;line-height:20px;cursor:pointer}
.mc-tool:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-tool-name{font-family:var(--dsw-font-markdown-code-block-font-family);font-size:12px;color:var(--dsw-alias-label-primary);flex:1 1 0;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-tool-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.mc-dot-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:1px solid transparent;border-radius:999px;background:0 0;cursor:pointer}
.mc-dot-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.mc-dot-btn:disabled{cursor:default;opacity:.6;border-color:transparent;background:0 0}
.mc-empty{padding:16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px}
.mc-error{padding:12px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;color:var(--dsw-alias-state-error-primary);font-size:13px}
.mc-error p{margin:0}
.mc-error p.mc-error-hint{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.mc-error-actions{display:flex;justify-content:flex-end;margin-top:10px}
.mc-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary);font-size:13px}
.mc-skill{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.mc-skill-row{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:10px 12px;background:0 0;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mc-skill-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-skill-name{font-weight:600;font-size:14px;line-height:20px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-skill-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0}
/* A row has no room for prose: let a long source label truncate instead of
   pushing the row's buttons past the right edge. */
.mc-source{font-size:11px;line-height:18px;color:var(--dsw-alias-label-caption);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
/* One sentence to confirm a row action: the shared modal chrome, sized down. */
.mc-confirm-dialog{width:min(420px,calc(100vw - 48px))}
.mc-search-dialog{width:min(520px,calc(100vw - 48px))}
.mc-confirm-body{display:flex;flex-direction:column;gap:12px;padding:14px 16px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.mc-confirm-body p{margin:0}
.mc-search-field{display:flex;flex-direction:column;gap:5px;color:var(--dsw-alias-label-primary)}
.mc-search-label-row{display:flex;align-items:baseline;justify-content:space-between;gap:4px 8px;flex-wrap:wrap}
.mc-search-label-row span{flex:1 1 260px;text-align:right;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.mc-search-field input,.mc-search-field textarea{box-sizing:border-box;width:100%;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px}
.mc-search-field textarea{min-height:116px;resize:vertical}
.mc-search-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}
/* A directory has no spaces to break at, and the modal is where it can show in
   full: wrap it instead of truncating it the way a row's 来源 slot must. */
.mc-confirm-path{font-family:var(--dsw-font-markdown-code-block-font-family);word-break:break-all}
.mc-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.mc-skill-body{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 12px 12px}
/* 预设技能组：预设 id 是页签之下的分组小标题，不是新一级页签。 */
.mc-skill-group{display:flex;flex-direction:column;gap:8px;min-width:0}
.mc-skill-group-title{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:0 2px}
.mc-tree{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:20px}
.mc-tree-row{display:flex;align-items:center;gap:8px;padding:3px 4px;border-radius:6px;cursor:pointer;min-width:0}
.mc-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-tree-indent{flex:none;width:16px}
.mc-tree-icon{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}
.mc-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-tree-file:hover .mc-tree-name{color:var(--dsw-alias-label-primary)}
.mc-preview{width:min(720px,calc(100vw - 48px));max-height:min(560px,calc(100vh - 96px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-alias-bg-mask-drop)}
.mc-preview-body{overflow:auto;flex:1 1 auto;min-height:0;padding:14px 16px;color:var(--dsw-alias-label-primary)}
.mc-preview-body>pre,.mc-preview-plain{margin:0;font-family:var(--dsw-font-markdown-code-block-font-family);font-size:12px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.mc-tool-description{padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mc-frontmatter{width:100%;margin:0 0 20px;border-collapse:collapse;table-layout:fixed;font-size:13px;line-height:20px}
.mc-frontmatter th,.mc-frontmatter td{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;text-align:left}
.mc-frontmatter th{width:130px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.mc-frontmatter td{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}
.mc-preview-hint{padding:16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}
/* ---- 总览（OverviewPanel） ---- */
.mc-metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.mc-metric{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;min-width:0}
.mc-metric-label{font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.mc-metric-value{font-size:20px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums}
.mc-metric-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.mc-attention{margin-top:4px}
.mc-attention-title{margin:0 0 6px;font-size:13px;font-weight:600}
.mc-attention-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.mc-attention-item{font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.mc-attention-item--failures{color:var(--dsw-alias-state-warn-primary)}
.mc-attention-item--coverage{color:var(--dsw-alias-state-warn-primary)}
/* ---- 思考限制（GuardPanel） ---- */
.mc-guard-boundary{margin:0;padding:8px 12px;border-radius:8px;font-size:12px;line-height:18px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);
  color:var(--dsw-alias-label-secondary)}
/* v3 数据看板：真实计数板 + 可编辑阈值 */
.mc-guard-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;
  background:var(--dsw-alias-border-l2);border:1px solid var(--dsw-alias-border-l2);
  border-radius:8px;overflow:hidden;margin:10px 0}
.mc-guard-stat{background:var(--dsw-alias-bg-l1);padding:10px 12px}
.mc-guard-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}
.mc-guard-stat-value{font-size:19px;font-weight:600;line-height:1.15;
  font-variant-numeric:tabular-nums;font-family:var(--dsw-font-code)}
.mc-guard-stat-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-top:3px;line-height:1.35}
.mc-guard-stats-since{grid-column:1/-1;margin:0;padding:7px 12px;font-size:10.5px;
  color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-l2)}
.mc-guard-threshold-edit{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mc-guard-threshold-edit-label{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.mc-guard-threshold-edit-input{width:150px;padding:3px 7px;border-radius:6px;font-size:12px;
  font-family:var(--dsw-font-code);color:inherit;background:transparent;
  border:1px solid var(--dsw-alias-border-l2)}
.mc-guard-threshold-edit-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mc-guard-threshold-edit-input:disabled{opacity:.6}
.mc-guard-threshold-edit-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.mc-guard-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.mc-guard-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;
  background:var(--dsw-alias-bg-layer-2)}
.mc-guard-title{font-size:13px;font-weight:600}
.mc-guard-model{font-family:var(--dsw-font-code);font-size:11px;line-height:18px;
  color:var(--dsw-alias-label-tertiary);margin-left:auto}
.mc-guard-body{padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:8px}
.mc-guard-points{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px}
.mc-guard-point{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mc-guard-thresholds{font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary);
  display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.mc-guard-thresholds-label{font-family:inherit}
.mc-guard-thresholds-value{font-family:var(--dsw-font-code);color:var(--dsw-alias-label-secondary)}
.mc-guard-switch{position:relative;flex:none;width:34px;height:20px;border-radius:999px;border:none;
  padding:0;cursor:pointer;background:var(--dsw-alias-state-idle-primary);transition:background .16s ease}
.mc-guard-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;
  border-radius:50%;background:#fff;transition:transform .16s ease}
.mc-guard-switch--on{background:var(--dsw-alias-state-business-primary)}
.mc-guard-switch--on::after{transform:translateX(14px)}
.mc-guard-switch:disabled{opacity:.5;cursor:not-allowed}
/* ---- v3 工具与技能（V3-c）：仅新增，不改动上面任何 .mc-* / .mc-guard-* ---- */
.v3-dot[data-tone='info']{background:var(--v3-info)}
.v3-trow{cursor:pointer}
.v3-trow:focus-visible{outline:2px solid var(--v3-info);outline-offset:-2px}
.v3-racts{display:flex;align-items:center;gap:4px;margin-left:auto;flex:none}
button.v3-tag.v3-tag--act{color:var(--v3-t3);background:transparent}
button.v3-tag.v3-tag--act:hover{color:var(--v3-t1);background:var(--v3-panel-2)}
button.v3-tag{border:0;cursor:pointer;font-family:inherit}
button.v3-tag:disabled{opacity:.55;cursor:default}
.v3-group>summary:focus-visible{outline:2px solid var(--v3-info);outline-offset:-2px}
.v3-tools{display:flex;flex-direction:column}
/* ---- v3 catalog rework: 一行工具栏 / 能力诊断卡片 / 卡片向总览看齐 ---- */
.mc-cat-root{display:flex;flex-direction:column;gap:12px;min-width:0}
.mc-cat-root .v3-catstat{margin-bottom:0}
.mc-cat-bar{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0}
.mc-cat-bar>.mc-cat-actions{flex:none}
.mc-cat-bar .mc-cat-actions button{font-size:11px;white-space:nowrap}
.mc-cat-tabs{display:flex;align-items:center;flex:none;min-width:0}
.mc-cat-tabs .mc-main-tabs{border-bottom:0}
.mc-cat-search{flex:1 1 auto;width:auto;min-width:96px;max-width:220px;display:flex}
.mc-cat-search input{box-sizing:border-box;width:100%;height:28px;padding:0 9px;border:1px solid var(--v3-line-2);border-radius:var(--v3-r-sm);background:var(--v3-panel);color:var(--v3-t1);font:inherit;font-size:12.5px}
.mc-cat-search input:hover{border-color:var(--v3-line-2)}
.mc-cat-search input:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px;border-color:transparent}
.mc-cat-actions{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto;flex-wrap:nowrap}
.mc-cat-diag{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);overflow:hidden}
.mc-cat-diag>summary{display:flex;align-items:center;gap:8px;padding:11px 15px;min-height:38px;cursor:pointer;list-style:none;font-size:12.5px;font-weight:600;color:var(--v3-t2)}
.mc-cat-diag>summary::-webkit-details-marker{display:none}
.mc-cat-diag>summary:hover{background:var(--v3-panel-2)}
.mc-cat-diag[open]>summary{border-bottom:1px solid var(--v3-line)}
.mc-cat-diag-body{display:flex;flex-direction:column;gap:4px;padding:11px 15px;font-size:11.5px;line-height:18px;color:var(--v3-t3)}
.v3-root .v3-catgrid{gap:14px}
.v3-root .v3-group{border-radius:var(--v3-r-lg);margin-bottom:0}
.v3-root .v3-group>summary{padding:11px 15px;min-height:38px}
.v3-root .v3-tag{font-size:11px;height:19px;line-height:19px;padding:0 7px}
.v3-root .v3-trow{min-height:34px;font-size:12.5px}
`;
if (typeof document !== "undefined" && document.querySelector(`style[data-css-id="${CSS_ID}"]`) === null) {
	const tag = document.createElement("style");
	tag.dataset.cssId = CSS_ID;
	tag.textContent = CSS;
	document.head.appendChild(tag);
}
/** Reuse dsh's safe Markdown renderer in tool descriptions and skill files. */
function MarkdownPreview(props) {
	const { text, t } = props;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
		text,
		labels: {
			code: {
				copyLabel: t("markdownCopy"),
				copiedLabel: t("markdownCopied"),
				toolbarLabels: {
					codeLabel: t("markdownCode"),
					wrapLabel: t("markdownWrap"),
					unwrapLabel: t("markdownUnwrap")
				}
			},
			footnotes: t("markdownFootnotes")
		}
	});
}
/** Parse the simple property lines shown by GitHub above a Markdown document. */
function parseFrontmatterProperties(source) {
	const properties = [];
	for (const line of source.split(/\r?\n/)) {
		const field = /^([A-Za-z0-9_.-]+):(?:[ \t]*(.*))?$/.exec(line);
		if (field !== null) {
			properties.push({
				name: field[1],
				value: field[2] ?? ""
			});
			continue;
		}
		const continuation = /^\s+(.+)$/.exec(line);
		if (continuation !== null && properties.length > 0) {
			const last = properties[properties.length - 1];
			last.value = last.value.length === 0 ? continuation[1] : `${last.value}\n${continuation[1]}`;
		}
	}
	return properties.map((property) => ({
		...property,
		value: property.value.trimEnd()
	}));
}
/** Split YAML properties from the Markdown body. */
function splitMarkdownFrontmatter(text) {
	const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (match === null) return { body: text };
	return {
		frontmatter: parseFrontmatterProperties(match[1] ?? ""),
		body: text.slice(match[0].length)
	};
}
function MarkdownFilePreview(props) {
	const { frontmatter, body } = splitMarkdownFrontmatter(props.text);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [frontmatter !== void 0 && frontmatter.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("table", {
		className: "mc-frontmatter",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: frontmatter.map((property) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
			scope: "row",
			children: property.name
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: property.value })] }, property.name)) })
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownPreview, {
		text: body,
		t: props.t
	})] });
}
/**
* dsh's skill source labels, shown on rows this plugin cannot edit — so "why is
* there no 编辑 button" has a visible answer. Labels that name one directory are
* shown as that path; the rest name a category and go through the dictionary, so
* none of dsh's internal labels (`custom`, `bundled`, …) reach the operator raw.
*/
const SOURCE_PATHS = {
	"user-dsh": "~/.dsh/skills",
	"user-agents": "~/.agents/skills",
	"project-dsh": "<project>/.dsh/skills",
	"project-agents": "<project>/.agents/skills"
};
/** Source labels that name no single directory; shown via `t`. */
const SOURCE_LABEL_KEYS = {
	"custom": "sourceCustom",
	"bundled": "sourceBundled"
};
/** How to name a skill's source root on a row we cannot manage. */
function sourceLabel(source, t) {
	if (source === void 0) return t("skillUnmanaged");
	const path = SOURCE_PATHS[source];
	if (path !== void 0) return path;
	const key = SOURCE_LABEL_KEYS[source];
	return key === void 0 ? source : t(key);
}
/** Tone of a class chip / state dot, mapped to the v3 `data-tone` palette. */
const CLASS_TONE = {
	resident: "info",
	"on-demand": "warn",
	disabled: "bad"
};
/** State-dot tone inside a row: resident=info, on-demand=warn, disabled=neutral. */
const CLASS_DOT_TONE = {
	resident: "info",
	"on-demand": "warn",
	disabled: ""
};
/** The four-cell `.v3-catstat` strip at the top of the catalog page. */
function CatalogStatStrip(props) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "v3-catstat",
		"data-v3-catstat": "true",
		children: props.cells.map((cell, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "v3-l",
			children: cell.label
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "v3-v",
			children: [cell.value, cell.hint !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: cell.hint }) : null]
		})] }, index))
	});
}
/** Strip a tool’s mcp__<server>__ prefix for display, like the old row did. */
function displayToolName(server, name) {
	const prefix = "mcp__" + server + "__";
	return server !== "built-in" && name.startsWith(prefix) ? name.slice(prefix.length) : name;
}
/**
* 保存反馈里怎么称呼这次被移动的能力。
*
* 单个用行上的显示名（工具去掉 `mcp__<server>__` 前缀，技能用自己的名字）；
* 多个只报项数，复用 `toolCount` 的「N 个工具」——一条横幅讲一件事，逐条罗列
* 在分组里点一下就能看到。批量移动只出现在 Tools 的服务器分组徽标上（技能的
* 行徽标每次只带一个 id），所以这里按工具计数即可。
*/
function movedSubject(rows, ids, t) {
	if (ids.length > 1) return t("toolCount", { count: ids.length });
	const id = ids[0];
	const row = rows.find((entry) => entry.id === id);
	if (row === void 0) return id;
	return row.server === void 0 ? row.name : displayToolName(row.server, row.name);
}
/**
* Two-column `.v3-catgrid` of native `<details>` server groups, each summary
* carrying the chevron and the class-count tags, each row a 30px `.v3-trow`.
* Pure: every interaction is a callback.
*/
function ToolGroupsView(props) {
	const { t, groups, openServers, busy } = props;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "v3-catgrid",
		"data-v3-catgrid": "true",
		children: groups.map(({ server, tools }) => {
			const open = openServers.has(server);
			const counts = CLASS_KEYS.map((cls) => ({
				cls,
				count: countByClass(tools, cls)
			}));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: "v3-group",
				open,
				"data-v3-group": server,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
					onClick: (e) => {
						e.preventDefault();
						props.onToggle(server);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							className: "v3-chev",
							viewBox: "0 0 12 12",
							fill: "none",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								d: "M4.5 2.5 8 6l-3.5 3.5",
								stroke: "currentColor",
								strokeWidth: 1.4,
								strokeLinecap: "round",
								strokeLinejoin: "round"
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "v3-gnm",
							children: server === "built-in" ? t("builtInGroup") : server
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "v3-cnt",
							children: tools.length
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "v3-right",
							children: [counts.filter(({ count }) => count > 0).map(({ cls, count }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "v3-tag",
								"data-tone": CLASS_TONE[cls],
								disabled: busy,
								title: t("cycleHint"),
								onClick: (e) => {
									e.stopPropagation();
									props.onCycle(tools.filter((tool) => tool.class === cls).map((tool) => tool.id), "tool");
								},
								children: [
									t(CLASS_SHORT_KEYS[cls]),
									" ",
									count
								]
							}, cls)), server !== "built-in" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "v3-tag v3-tag--act",
								disabled: busy,
								onClick: (e) => {
									e.stopPropagation();
									props.onEditServer(server);
								},
								children: t("edit")
							})]
						})
					]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "v3-tools",
					children: tools.map((tool) => {
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "v3-trow",
							title: tool.classLabel,
							role: "button",
							tabIndex: 0,
							"aria-label": tool.name,
							onClick: () => props.onOpenDetail(tool.id),
							onKeyDown: (e) => {
								if (e.target !== e.currentTarget) return;
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									props.onOpenDetail(tool.id);
								}
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "v3-dot",
									"data-tone": CLASS_DOT_TONE[tool.class],
									"aria-hidden": "true"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "v3-nm",
									title: tool.name,
									children: displayToolName(server, tool.name)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "v3-racts",
									children: [
										tool.mandatory && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "v3-tag",
											children: t("mandatory")
										}),
										tool.class === "on-demand" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "v3-tag v3-tag--act",
											title: t("editSearchMetadata"),
											onClick: (e) => {
												e.stopPropagation();
												props.onEditSearch(tool.id);
											},
											children: t("searchMetadataButton")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "v3-tag",
											"data-tone": CLASS_TONE[tool.class],
											disabled: busy || tool.mandatory,
											title: tool.classLabel,
											"aria-label": tool.classLabel,
											onClick: (e) => {
												e.stopPropagation();
												props.onCycle([tool.id], "tool");
											},
											children: t(CLASS_SHORT_KEYS[tool.class])
										})
									]
								})
							]
						}, tool.id);
					})
				})]
			}, server);
		})
	});
}
/**
* Whether the document is visible. A hidden settings tab does no polling and
* takes no re-reads; coming back is itself a revalidation trigger.
*/
function useDocumentVisible() {
	const [visible, setVisible] = (0, react.useState)(true);
	(0, react.useEffect)(() => {
		const update = () => setVisible(document.visibilityState !== "hidden");
		update();
		document.addEventListener("visibilitychange", update);
		return () => document.removeEventListener("visibilitychange", update);
	}, []);
	return visible;
}
function CapabilitySection(props) {
	const { remote, t, mountError, subscribeSignals } = props;
	const [state, setState] = (0, react.useState)(() => {
		if (mountError !== void 0) return {
			status: "error",
			message: mountError
		};
		const cached = cachedSnapshot();
		return cached === void 0 ? { status: "loading" } : {
			status: "ready",
			snapshot: cached
		};
	});
	const [busy, setBusy] = (0, react.useState)(false);
	const [notice, setNotice] = (0, react.useState)(null);
	/**
	* 一次可见反馈（Toast）。只保留一个槽位：连点档位徽标时后来的反馈直接覆盖前
	* 一条，不排队、不叠成多条——一秒钟点三下不该留下三条横幅。
	*
	* `ok` 决定外观：成功保存带 `tone="success"` 的对勾；「分类未生效」沿用默认
	* 警示态（primitive 只有 success 一种 tone，省略即警示座）。
	* `seq` 用作 key：Toast 只在重新挂载时重播动画，同一句话连说两次也要动一次。
	*/
	const [toast, setToast] = (0, react.useState)(null);
	const toastSeq = (0, react.useRef)(0);
	/**
	* 显示一条反馈并占用唯一的槽位。
	*
	* 覆盖面广、成功/失败都走这里：避免出现「状态已更新但屏幕上什么都没说」的
	* 空档（验收要求「看到保存反馈」），也保证同时只有一条横幅。
	*/
	const showFeedback = (0, react.useCallback)((text, ok) => {
		toastSeq.current += 1;
		setToast({
			text,
			ok,
			seq: toastSeq.current
		});
	}, []);
	const [diagnostics, setDiagnostics] = (0, react.useState)(null);
	const [retryMcp, setRetryMcp] = (0, react.useState)(null);
	const queuedMcpRefresh = (0, react.useRef)(null);
	const [openServers, setOpenServers] = (0, react.useState)(/* @__PURE__ */ new Set());
	const [activeTab, setActiveTab] = (0, react.useState)("tools");
	const reload = (0, react.useCallback)(async () => {
		if (mountError !== void 0) {
			setState({
				status: "error",
				message: mountError
			});
			return;
		}
		try {
			setState(await loadSnapshot(remote).then((snapshot) => ({
				status: "ready",
				snapshot
			})));
		} catch (e) {
			setState((prev) => prev.status === "ready" ? prev : {
				status: "error",
				message: String(e)
			});
			setNotice(String(e));
		}
	}, [remote, mountError]);
	(0, react.useEffect)(() => {
		reload();
	}, [reload]);
	(0, react.useEffect)(() => {
		if (remote.getDiagnostics === void 0) return;
		let cancelled = false;
		remote.getDiagnostics().then((result) => {
			if (!cancelled && result.ok) setDiagnostics(result.value);
		}).catch((error) => {
			console.warn("[capability-menu] diagnostics unavailable:", error);
		});
		return () => {
			cancelled = true;
		};
	}, [remote]);
	const [refreshing, setRefreshing] = (0, react.useState)(false);
	/**
	* Rebuild the host catalog, then re-read the classification list. Used after
	* registering a new source so the list reflects it without waiting for the
	* scheduler's debounce window.
	*/
	const refreshCatalog = (0, react.useCallback)(async () => {
		if (refreshing) return;
		setRefreshing(true);
		setRetryMcp(null);
		try {
			await withTransientRetry(async () => unwrap(await remote.refresh(), "capabilityPolicy.refresh"));
			await reload();
			if (remote.getDiagnostics !== void 0) {
				const result = unwrap(await remote.getDiagnostics(), "capabilityPolicy.getDiagnostics");
				setDiagnostics(result);
			}
			setNotice(null);
		} catch (e) {
			console.error("[capability-menu] refresh failed:", e);
			setNotice(t("refreshFailed"));
		} finally {
			setRefreshing(false);
		}
	}, [
		refreshing,
		remote,
		reload,
		t
	]);
	/**
	* A new MCP row is persisted before dsh applies it and registers its tools.
	* Wait for that asynchronous host reload instead of taking one snapshot too
	* early and requiring the operator to leave and reopen this settings page.
	*/
	const refreshRegisteredMcp = (0, react.useCallback)(async (serverName) => {
		if (refreshing) {
			queuedMcpRefresh.current = serverName;
			return;
		}
		setRefreshing(true);
		setRetryMcp(null);
		try {
			await withTransientRetry(async () => unwrap(await remote.refresh(), "capabilityPolicy.refresh"));
			const snapshot = await waitForMcpTools(remote, serverName, [
				250,
				500,
				750,
				1e3,
				1e3,
				1e3,
				1e3,
				1e3,
				1e3
			]);
			if (snapshot !== void 0) {
				setState({
					status: "ready",
					snapshot: rememberSnapshot(snapshot)
				});
				setNotice(null);
				setRetryMcp(null);
			} else {
				setNotice(t("mcpToolsPending", { name: serverName }));
				setRetryMcp(serverName);
			}
		} catch (e) {
			console.error("[capability-menu] MCP refresh failed:", e);
			setNotice(t("refreshFailed"));
			setRetryMcp(serverName);
		} finally {
			setRefreshing(false);
		}
	}, [
		refreshing,
		remote,
		t
	]);
	(0, react.useEffect)(() => {
		if (refreshing || queuedMcpRefresh.current === null) return;
		const serverName = queuedMcpRefresh.current;
		queuedMcpRefresh.current = null;
		refreshRegisteredMcp(serverName);
	}, [refreshing, refreshRegisteredMcp]);
	const toggleServer = (0, react.useCallback)((server) => {
		setOpenServers((prev) => {
			const next = new Set(prev);
			if (next.has(server)) next.delete(server);
			else next.add(server);
			return next;
		});
	}, []);
	const visible = useDocumentVisible();
	const [pendingSignal, setPendingSignal] = (0, react.useState)(false);
	const seenVersion = (0, react.useRef)(void 0);
	const pollFailures = (0, react.useRef)(0);
	const gate = (0, react.useRef)({
		visible: true,
		ready: false,
		busy: false,
		rebuilding: false
	});
	(0, react.useEffect)(() => {
		gate.current = {
			visible,
			ready: state.status === "ready",
			busy,
			rebuilding: refreshing
		};
	});
	/**
	* A signal that the host catalog may have moved. Runs now when the page is
	* idle; otherwise parks until it is, so a signal that lands mid-click is
	* never dropped (and never repaints the row under the cursor).
	*/
	const onExternalSignal = (0, react.useCallback)(() => {
		if (canRevalidate(gate.current)) refreshCatalog();
		else setPendingSignal(true);
	}, [refreshCatalog]);
	(0, react.useEffect)(() => {
		return subscribeSignals(onExternalSignal);
	}, [subscribeSignals, onExternalSignal]);
	(0, react.useEffect)(() => {
		if (!pendingSignal) return;
		if (!canRevalidate({
			visible,
			ready: state.status === "ready",
			busy,
			rebuilding: refreshing
		})) return;
		setPendingSignal(false);
		refreshCatalog();
	}, [
		pendingSignal,
		visible,
		state.status,
		busy,
		refreshing,
		refreshCatalog
	]);
	(0, react.useEffect)(() => {
		if (!visible || state.status !== "ready" || busy || refreshing) return;
		let stopped = false;
		let timer;
		const tick = async () => {
			try {
				const version = unwrap(await withDeadline(remote.catalogVersion(), POLL_SAMPLE_TIMEOUT_MS), "capabilityPolicy.catalogVersion");
				pollFailures.current = 0;
				if (versionChanged(seenVersion.current, version)) {
					seenVersion.current = version;
					await reload();
				}
			} catch {
				pollFailures.current += 1;
			}
			if (!stopped) timer = setTimeout(() => void tick(), pollDelayMs(pollFailures.current));
		};
		timer = setTimeout(() => void tick(), 0);
		return () => {
			stopped = true;
			if (timer !== void 0) clearTimeout(timer);
		};
	}, [
		visible,
		state.status,
		busy,
		refreshing,
		remote,
		reload
	]);
	/**
	* 把一组 id 切到下一档：常驻 → 按需 → 禁用 → 常驻。
	*
	* 上游远程面没有 intent-level 的 `moveCapabilities`，因此写回走
	* `./view-model.ts` 的 `moveCapabilities`（`getConfig` 读出该 kind 的三档 →
	* 只动这几个 id → `updateConfig` 回写这一个 kind）。代价是读-改-写之间有一个
	* 极短窗口，另一个窗口的并发移动可能被覆盖；收益是上游一字不改，且行为与上游
	* 页面自己的整表写回完全一致。写入失败原样抛出（服务端先校验再提交）。
	*/
	const cycleClass = (0, react.useCallback)(async (ids, kind) => {
		if (ids.length === 0 || busy) return;
		setBusy(true);
		const to = nextTier(ids.map((id) => state.status === "ready" ? state.snapshot.rows.find((r) => r.id === id)?.class : void 0).find((c) => c !== void 0) ?? "on-demand");
		const moved = new Set(ids);
		setState((prev) => prev.status === "ready" ? {
			status: "ready",
			snapshot: { rows: prev.snapshot.rows.map((row) => moved.has(row.id) ? {
				...row,
				class: to,
				classLabel: void 0
			} : row) }
		} : prev);
		try {
			await moveCapabilities(remote, {
				kind,
				ids,
				target: to
			});
			const next = await loadSnapshot(remote);
			setState({
				status: "ready",
				snapshot: next
			});
			const overridden = overriddenIds(ids, to, next.rows);
			if (overridden.length > 0) showFeedback(t("cycleOverridden", { count: overridden.length }), false);
			else {
				setNotice(null);
				showFeedback(t("cycleSaved", {
					name: movedSubject(next.rows, ids, t),
					tier: t(CLASS_SHORT_KEYS[to])
				}), true);
			}
		} catch (e) {
			setNotice(String(e));
			await reload();
		} finally {
			setBusy(false);
		}
	}, [
		remote,
		busy,
		state,
		t,
		reload,
		showFeedback
	]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: "v3-root mc-section",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(V3Styles, {}),
			toast !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				text: toast.text,
				...toast.ok ? { tone: "success" } : {},
				holdMs: 4e3,
				onDone: () => setToast((current) => current === toast ? null : current)
			}, toast.seq),
			state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				className: "mc-empty",
				children: [t("desc"), "…"]
			}),
			state.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mc-error",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: state.message }),
					state.message.includes("Failed to fetch") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "mc-error-hint",
						children: t("carrierFailureHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-error-actions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "outline",
							onClick: () => void reload(),
							children: t("retry")
						})
					})
				]
			}),
			notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mc-notice",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: notice }), retryMcp !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					variant: "outline",
					disabled: refreshing,
					onClick: () => void refreshRegisteredMcp(retryMcp),
					children: t("retry")
				})]
			}),
			state.status === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReadyBody, {
				remote,
				snapshot: state.snapshot,
				diagnostics,
				openServers,
				busy,
				activeTab,
				t,
				onTabChange: setActiveTab,
				onToggleServer: toggleServer,
				onCycle: cycleClass,
				onRefresh: () => void refreshCatalog(),
				onRefreshMcp: (serverName) => void refreshRegisteredMcp(serverName),
				onNotice: setNotice
			})
		]
	});
}
function ReadyBody(props) {
	const { remote, snapshot, diagnostics, openServers, busy, activeTab, t, onTabChange, onToggleServer, onCycle, onRefresh, onRefreshMcp, onNotice } = props;
	const [updateStatus, setUpdateStatus] = (0, react.useState)(null);
	const [updatePhase, setUpdatePhase] = (0, react.useState)("idle");
	const [updateError, setUpdateError] = (0, react.useState)("");
	const [updateDialogOpen, setUpdateDialogOpen] = (0, react.useState)(false);
	const [sourceStepsOpen, setSourceStepsOpen] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		let cancelled = false;
		const check = async () => {
			try {
				const status = unwrap(await remote.checkSelfUpdate(), "capabilityPolicy.checkSelfUpdate");
				if (!cancelled) setUpdateStatus(status);
			} catch (error) {
				if (!cancelled) console.warn("[capability-menu] update check failed:", error);
			}
		};
		const checkWhenVisible = () => {
			if (document.visibilityState === "visible") check();
		};
		check();
		document.addEventListener("visibilitychange", checkWhenVisible);
		const interval = window.setInterval(checkWhenVisible, 9e5);
		return () => {
			cancelled = true;
			document.removeEventListener("visibilitychange", checkWhenVisible);
			window.clearInterval(interval);
		};
	}, [remote]);
	const installUpdate = (0, react.useCallback)(async (source) => {
		if (updateStatus === null || !updateStatus.updateAvailable) return;
		if (source === "registry" ? !updateStatus.updatable : updateStatus.reason !== "local") return;
		setUpdatePhase("installing");
		setUpdateError("");
		try {
			if (source === "local") unwrap(await remote.switchSelfToNpm(updateStatus.latest), "capabilityPolicy.switchSelfToNpm");
			else unwrap(await remote.installSelfUpdate(updateStatus.latest), "capabilityPolicy.installSelfUpdate");
			setUpdatePhase("done");
			setUpdateDialogOpen(false);
		} catch (error) {
			setUpdateError(String(error));
			setUpdatePhase("error");
		}
	}, [remote, updateStatus]);
	const closeUpdateDialog = () => {
		if (updatePhase === "installing") return;
		setUpdateDialogOpen(false);
		setSourceStepsOpen(false);
		if (updatePhase === "error") setUpdatePhase("idle");
	};
	/** Name filter, shared by both tabs: it narrows whichever list is shown. */
	const [filter, setFilter] = (0, react.useState)("");
	const nameFilter = compileNameFilter(filter);
	const needle = nameFilter.needle;
	const shownRows = filterRows(snapshot.rows, nameFilter, {
		builtIn: t("builtInGroup"),
		source: (source) => sourceLabel(source, t)
	});
	const { servers, skills } = groupRows(shownRows);
	const { presetSkills, presetGroups, projectSkills, globalSkills } = splitSkillGroups(skills);
	const [skillTab, setSkillTab] = (0, react.useState)("global");
	const statRows = activeTab === "tools" ? shownRows.filter((r) => r.kind === "tool") : skillTab === "project" ? projectSkills : skillTab === "preset" ? presetSkills : globalSkills;
	const summary = CLASS_KEYS.map((cls) => ({
		cls,
		count: countByClass(statRows, cls)
	}));
	/** Tool-detail modal: one schema popup at a time. */
	const [toolDetail, setToolDetail] = (0, react.useState)(null);
	/** Token for the open tool-detail request: closing/opening advances it so a
	*  late reply cannot re-open a pane the operator already dismissed. */
	const toolDetailRequest = (0, react.useRef)(0);
	/** Fetch and show the model-facing tool definition (name/description/parameters). */
	const openToolDetail = (0, react.useCallback)(async (id) => {
		const request = toolDetailRequest.current + 1;
		toolDetailRequest.current = request;
		setToolDetail({
			id,
			status: "loading"
		});
		try {
			const detail = unwrap(await remote.getDetail(id), "capabilityPolicy.getDetail");
			if (toolDetailRequest.current !== request) return;
			setToolDetail(detail === void 0 ? {
				id,
				status: "error",
				message: t("detailNotFound")
			} : {
				id,
				status: "ready",
				detail
			});
		} catch (error) {
			if (toolDetailRequest.current !== request) return;
			setToolDetail({
				id,
				status: "error",
				message: String(error)
			});
		}
	}, [remote, t]);
	/** Current exposure rules and summaries from the live search index. */
	const [catalogDocs, setCatalogDocs] = (0, react.useState)(null);
	const [catalogTab, setCatalogTab] = (0, react.useState)("policy");
	const [summaryLimitDraft, setSummaryLimitDraft] = (0, react.useState)("");
	const [summaryLimitSaving, setSummaryLimitSaving] = (0, react.useState)(false);
	const [summaryLimitError, setSummaryLimitError] = (0, react.useState)(void 0);
	const [searchEdit, setSearchEdit] = (0, react.useState)(null);
	const [searchDescription, setSearchDescription] = (0, react.useState)("");
	const [searchSaving, setSearchSaving] = (0, react.useState)(false);
	/** Token for the search-metadata read: closing advances it so a late reply
	*  cannot re-open a dialog the operator already dismissed (same guard the
	*  tool detail and the skill file preview use). */
	const searchEditRequest = (0, react.useRef)(0);
	const openSearchEdit = (0, react.useCallback)(async (id, kind) => {
		const request = searchEditRequest.current + 1;
		searchEditRequest.current = request;
		setSearchEdit({
			status: "loading",
			id,
			kind
		});
		try {
			const metadata = unwrap(await remote.getSearchMetadata(id, kind), "capabilityPolicy.getSearchMetadata");
			if (searchEditRequest.current !== request) return;
			if (metadata === void 0) throw new Error(t("detailNotFound"));
			setSearchDescription(metadata.description ?? metadata.defaultDescription);
			setSearchEdit({
				status: "ready",
				id,
				kind,
				metadata
			});
		} catch (error) {
			if (searchEditRequest.current !== request) return;
			setSearchEdit({
				status: "error",
				id,
				kind,
				message: String(error)
			});
		}
	}, [remote, t]);
	const saveSearchEdit = (0, react.useCallback)(async () => {
		if (searchEdit === null || searchEdit.status !== "ready") return;
		setSearchSaving(true);
		try {
			unwrap(await remote.updateSearchMetadata({
				id: searchEdit.id,
				kind: searchEdit.kind,
				description: searchDescription
			}), "capabilityPolicy.updateSearchMetadata");
			setSearchEdit(null);
			onNotice(t("searchMetadataSaved"));
		} catch (error) {
			setSearchEdit({
				...searchEdit,
				message: String(error)
			});
		} finally {
			setSearchSaving(false);
		}
	}, [
		searchEdit,
		searchDescription,
		remote,
		onNotice,
		t
	]);
	/** 注册能力 modal; its default sub-tab follows `activeTab`. */
	const [registerOpen, setRegisterOpen] = (0, react.useState)(false);
	/** 编辑 target; at most one is set. */
	const [editMcp, setEditMcp] = (0, react.useState)(void 0);
	const [editSkill, setEditSkill] = (0, react.useState)(void 0);
	/**
	* Skill directories registered under the skill root. Only those can be
	* edited: a project or bundled skill has no row to repoint, so its row gets
	* no 编辑 button rather than a button that always fails.
	*/
	const [editableSkills, setEditableSkills] = (0, react.useState)(/* @__PURE__ */ new Set());
	const skillSignature = skills.map((skill) => `${skill.id}\u0000${skill.source ?? ""}`).join("");
	(0, react.useEffect)(() => {
		let cancelled = false;
		(async () => {
			try {
				const rows = unwrap(await remote.listSkillLocations(), "capabilityPolicy.listSkillLocations");
				if (!cancelled) setEditableSkills(new Set(rows.map((row) => row.skillName ?? row.name)));
			} catch {}
		})();
		return () => {
			cancelled = true;
		};
	}, [remote, skillSignature]);
	/** Open the 编辑 form for the MCP server behind a Tools-tab group header. */
	const openMcpEdit = (0, react.useCallback)(async (serverName) => {
		try {
			const found = unwrap(await remote.listLocations(), "capabilityPolicy.listLocations").find((row) => row.serverName === serverName);
			if (found === void 0) {
				onNotice(t("notEditable"));
				return;
			}
			setEditMcp(found);
		} catch (e) {
			onNotice(String(e));
		}
	}, [
		remote,
		t,
		onNotice
	]);
	/**
	* Adopt a skill that dsh discovered from a user-level root this plugin reads
	* but does not manage: link its own directory into the user root so it becomes
	* an editable entry. The content is untouched.
	*/
	const adoptSkill = (0, react.useCallback)(async (name) => {
		try {
			const entry = unwrap(await remote.adoptSkillLocation(name), "capabilityPolicy.adoptSkillLocation");
			onNotice(t("skillAdopted", { path: entry }));
			onRefresh();
		} catch (e) {
			onNotice(String(e));
		}
	}, [
		remote,
		t,
		onNotice,
		onRefresh
	]);
	/**
	* Open the 编辑 form for a managed skill entry. `name` is the skill's declared
	* name, which is what the row and the panel address it by — an entry is
	* matched on that rather than on its own, possibly different, name. A bare
	* name can exist in both the user root and a project root, so the row's source
	* decides which entry the click meant; without it we fall back to the first
	* match.
	*/
	const openSkillEdit = (0, react.useCallback)(async (name, source) => {
		try {
			const rows = unwrap(await remote.listSkillLocations(), "capabilityPolicy.listSkillLocations");
			const wanted = PROJECT_SKILL_SOURCES.has(source ?? "") ? "project" : "user";
			const named = rows.filter((row) => (row.skillName ?? row.name) === name);
			const found = named.find((row) => row.root === wanted) ?? named[0];
			if (found === void 0) {
				onNotice(t("notEditable"));
				return;
			}
			setEditSkill(found);
		} catch (e) {
			onNotice(String(e));
		}
	}, [
		remote,
		t,
		onNotice
	]);
	/** Token for the catalog-docs read: closing advances it so a late reply
	*  cannot re-open the dialog the operator already dismissed. */
	const catalogDocsRequest = (0, react.useRef)(0);
	/** Fetch exposure rules, searchable summaries, and the description limit. */
	const openCatalogDocs = (0, react.useCallback)(async () => {
		const request = catalogDocsRequest.current + 1;
		catalogDocsRequest.current = request;
		setCatalogDocs({ status: "loading" });
		try {
			const docs = unwrap(await remote.getCatalogDocs(), "capabilityPolicy.getCatalogDocs");
			if (catalogDocsRequest.current !== request) return;
			setSummaryLimitDraft(String(docs.summaryMaxChars));
			setSummaryLimitError(void 0);
			setCatalogDocs({
				status: "ready",
				docs
			});
		} catch (error) {
			if (catalogDocsRequest.current !== request) return;
			setCatalogDocs({
				status: "error",
				message: String(error)
			});
		}
	}, [remote]);
	const saveSummaryLimit = (0, react.useCallback)(async () => {
		if (catalogDocs?.status !== "ready") return;
		const value = Number(summaryLimitDraft);
		if (!/^\d+$/.test(summaryLimitDraft) || !Number.isSafeInteger(value) || value < 20) {
			setSummaryLimitError(t("summaryLimitInvalid"));
			return;
		}
		setSummaryLimitSaving(true);
		setSummaryLimitError(void 0);
		try {
			unwrap(await remote.updateSummaryMaxChars(value), "capabilityPolicy.updateSummaryMaxChars");
			const docs = unwrap(await remote.getCatalogDocs(), "capabilityPolicy.getCatalogDocs");
			setCatalogDocs({
				status: "ready",
				docs
			});
			setSummaryLimitDraft(String(docs.summaryMaxChars));
			onNotice(t("summaryLimitSaved"));
		} catch (error) {
			setSummaryLimitError(String(error));
		} finally {
			setSummaryLimitSaving(false);
		}
	}, [
		catalogDocs,
		summaryLimitDraft,
		remote,
		onNotice,
		t
	]);
	const skillDiagnosticCount = diagnostics === null ? 0 : diagnostics.unavailableSkills.length + diagnostics.shadowedSkills.length + diagnostics.brokenPresets.length + diagnostics.unbrowseableSkills.length + diagnostics.undocumentedSkills.length;
	const classCount = (cls) => summary.find((entry) => entry.cls === cls)?.count ?? 0;
	const statCells = [
		{
			label: t("residentShort"),
			value: classCount("resident")
		},
		{
			label: t("onDemandShort"),
			value: classCount("on-demand")
		},
		{
			label: t("disabledShort"),
			value: classCount("disabled")
		}
	];
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "mc-cat-root",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mc-cat-bar",
				"data-v3-catalog-bar": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-cat-tabs",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
							className: "mc-main-tabs",
							items: [{
								value: "tools",
								id: "mc-tab-tools",
								panelId: "mc-panel-tools",
								label: t("toolsGroup")
							}, {
								value: "skills",
								id: "mc-tab-skills",
								panelId: "mc-panel-skills",
								label: t("skillsGroup")
							}],
							value: activeTab,
							onChange: onTabChange,
							label: t("title")
						})
					}),
					snapshot.rows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-cat-search",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							type: "search",
							value: filter,
							placeholder: t("filterByName"),
							"aria-label": t("filterByName"),
							title: t("filterHint"),
							onChange: (e) => setFilter(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-cat-actions",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "outline",
								onClick: () => setRegisterOpen(true),
								children: t("registerCapability")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "outline",
								onClick: () => void openCatalogDocs(),
								children: t("viewCatalog")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								size: "sm",
								variant: "outline",
								onClick: () => window.open("https://github.com/YAN3RA/dsh-thinking-guard", "_blank", "noopener,noreferrer"),
								children: t("feedback")
							}),
							updateStatus?.updateAvailable && (updateStatus.updatable || updateStatus.reason === "local") && updatePhase !== "done" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								variant: "primary",
								size: "sm",
								className: "mc-update-check",
								title: t("updateAvailable", { version: updateStatus.latest }),
								disabled: updatePhase === "installing",
								onClick: () => setUpdateDialogOpen(true),
								children: t("newVersion")
							})
						]
					})
				]
			}),
			(updatePhase === "done" || updateStatus?.updateAvailable && !updateStatus.updatable && updateStatus.reason !== "local") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mc-update-status",
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: updatePhase === "done" ? t(updateStatus?.reason === "local" ? "pluginSwitched" : "pluginUpdated") : t("updateAvailable", { version: updateStatus?.latest ?? "" }) }), updatePhase !== "done" && updateStatus?.updateAvailable && !updateStatus.updatable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(updateStatus.reason === "non-registry" ? "pluginNonRegistrySource" : "pluginProfileUnavailable") })]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogStatStrip, { cells: statCells }),
			diagnostics !== null && skillDiagnosticCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: "mc-cat-diag",
				"data-v3-catalog-diagnostics": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("diagnosticTitle", { count: skillDiagnosticCount }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "mc-cat-diag-body",
					children: [
						diagnostics.unavailableSkills.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("diagnosticUnavailable", {
							name: item.name,
							source: item.source,
							preset: item.preset ?? ""
						}) }, `unavailable-${item.name}-${item.preset ?? ""}-${index}`)),
						diagnostics.shadowedSkills.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("diagnosticShadowed", {
							name: item.name,
							winner: item.selectedFrom,
							hidden: item.shadowedFrom
						}) }, `shadowed-${item.name}-${item.shadowedFrom}-${index}`)),
						diagnostics.brokenPresets.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("diagnosticBroken", {
							id: item.id,
							reason: item.reason
						}) }, `broken-${item.id}`)),
						diagnostics.unbrowseableSkills.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("diagnosticUnbrowseable", {
							name: item.name,
							reason: item.reason
						}) }, `browse-${item.name}`)),
						diagnostics.undocumentedSkills.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("diagnosticUndocumented", {
							name: item.name,
							summary: item.summary
						}) }, `undocumented-${item.name}`))
					]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				role: "tabpanel",
				id: "mc-panel-tools",
				"aria-labelledby": "mc-tab-tools",
				hidden: activeTab !== "tools",
				className: "mc-panel",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "mc-panel-inner",
					children: servers.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "mc-empty",
						children: needle === "" ? t("emptyTools") : t("filterNoMatch")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolGroupsView, {
						t,
						groups: servers,
						openServers,
						busy,
						onToggle: onToggleServer,
						onCycle,
						onOpenDetail: (id) => void openToolDetail(id),
						onEditServer: (server) => void openMcpEdit(server),
						onEditSearch: (id) => void openSearchEdit(id, "tool")
					})
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				role: "tabpanel",
				id: "mc-panel-skills",
				"aria-labelledby": "mc-tab-skills",
				hidden: activeTab !== "skills",
				className: `mc-panel${skills.length > 0 ? " mc-panel--tight" : ""}`,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "mc-panel-inner",
					children: skills.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "mc-empty",
						children: needle === "" ? t("emptySkills") : t("filterNoMatch")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-subtabs",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
							items: [
								{
									value: "global",
									id: "mc-skill-tab-global",
									panelId: "mc-skill-panel-global",
									label: t("globalSkills")
								},
								{
									value: "project",
									id: "mc-skill-tab-project",
									panelId: "mc-skill-panel-project",
									label: t("projectSkills")
								},
								{
									value: "preset",
									id: "mc-skill-tab-preset",
									panelId: "mc-skill-panel-preset",
									label: t("presetSkills")
								}
							],
							value: skillTab,
							onChange: setSkillTab,
							label: t("skillsGroup")
						})
					}), skillTab === "global" ? globalSkills.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillList, {
						skills: globalSkills,
						remote,
						busy,
						t,
						onCycle,
						editableSkills,
						onEditSkill: openSkillEdit,
						onAdoptSkill: adoptSkill,
						onEditSearch: (id) => void openSearchEdit(id, "skill")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "mc-empty",
						children: t("emptyGlobalSkills")
					}) : skillTab === "project" ? projectSkills.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillList, {
						skills: projectSkills,
						remote,
						busy,
						t,
						onCycle,
						editableSkills,
						onEditSkill: openSkillEdit,
						onAdoptSkill: adoptSkill,
						onEditSearch: (id) => void openSearchEdit(id, "skill")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "mc-empty",
						children: t("emptyProjectSkills")
					}) : presetGroups.length > 0 ? presetGroups.map(([preset, group]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-skill-group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "mc-skill-group-title",
							children: preset
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillList, {
							skills: group,
							remote,
							busy,
							t,
							onCycle,
							editableSkills,
							onEditSkill: openSkillEdit,
							onAdoptSkill: adoptSkill,
							onEditSearch: (id) => void openSearchEdit(id, "skill")
						})]
					}, preset)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "mc-empty",
						children: t("emptyPresetSkills")
					})] })
				})
			}),
			toolDetail !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: () => {
					toolDetailRequest.current += 1;
					setToolDetail(null);
				},
				title: toolDetail.detail?.name ?? toolDetail.id,
				closeLabel: t("previewClose"),
				children: [
					toolDetail.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-preview-hint",
						children: "…"
					}),
					toolDetail.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-preview-hint",
						children: toolDetail.message
					}),
					toolDetail.status === "ready" && toolDetail.detail !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-preview-body",
						children: [toolDetail.detail.description.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "mc-tool-description",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownPreview, {
								text: toolDetail.detail.description,
								t
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: "mc-preview-plain",
							children: JSON.stringify({
								type: "function",
								function: {
									name: toolDetail.detail.name,
									parameters: toolDetail.detail.parameters
								}
							}, null, 2)
						})]
					})
				]
			}),
			updateDialogOpen && updateStatus?.updateAvailable && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: closeUpdateDialog,
				title: t("updateDialogTitle"),
				closeLabel: t("previewClose"),
				className: "mc-update-dialog",
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "mc-confirm-actions mc-update-actions",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							type: "button",
							variant: "outline",
							size: "sm",
							className: "mc-update-cancel",
							disabled: updatePhase === "installing",
							onClick: closeUpdateDialog,
							children: t("cancel")
						}),
						updateStatus.reason === "local" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							type: "button",
							variant: "outline",
							size: "sm",
							disabled: updatePhase === "installing",
							onClick: () => setSourceStepsOpen((value) => !value),
							children: t(sourceStepsOpen ? "updateSourceStepsHide" : "updateSourceSteps")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							type: "button",
							variant: "primary",
							size: "sm",
							disabled: updatePhase === "installing",
							onClick: () => void installUpdate(updateStatus.reason === "local" ? "local" : "registry"),
							children: t(updateStatus.reason === "local" ? "switchAndInstall" : "installUpdate")
						})
					]
				}),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("updateVersionComparison", {
						current: updateStatus.current,
						latest: updateStatus.latest
					}) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(updateStatus.reason === "local" ? "updateLocalNote" : "updateNpmNote") }),
					updateStatus.reason === "local" && sourceStepsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-update-steps",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("updateSourceStepsIntro") }),
							updateStatus.sourcePath && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "mc-confirm-path",
								children: updateStatus.sourcePath
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: "git pull\npnpm install\npnpm run build" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("updateSourceStepsRestart") })
						]
					}),
					updatePhase === "installing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: t("updatingPlugin")
					}),
					updatePhase === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "mc-error",
						role: "alert",
						children: [
							t("pluginUpdateFailed"),
							" ",
							updateError
						]
					})
				]
			}),
			searchEdit !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: () => {
					searchEditRequest.current += 1;
					setSearchEdit(null);
				},
				title: `${t("editSearchMetadata")} · ${searchEdit.id}`,
				closeLabel: t("previewClose"),
				className: "mc-search-dialog",
				children: [
					searchEdit.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-preview-hint",
						children: "…"
					}),
					searchEdit.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-preview-hint",
						children: searchEdit.message
					}),
					searchEdit.status === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-confirm-body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mc-search-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "mc-search-label-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: "mc-search-description",
										children: t("searchDescription")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										id: "mc-search-description-note",
										children: t("searchMetadataNote")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									id: "mc-search-description",
									"aria-describedby": "mc-search-description-note",
									value: searchDescription,
									maxLength: searchEdit.metadata?.maxChars,
									disabled: searchSaving,
									onChange: (e) => setSearchDescription(e.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "mc-search-hint",
								children: [
									searchDescription.length,
									"/",
									searchEdit.metadata?.maxChars
								]
							}),
							searchEdit.message !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "mc-error",
								children: searchEdit.message
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mc-confirm-actions",
								children: [searchDescription !== searchEdit.metadata?.defaultDescription && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "ghost",
									disabled: searchSaving,
									title: t("searchMetadataRestoreHint"),
									onClick: () => setSearchDescription(searchEdit.metadata?.defaultDescription ?? ""),
									children: t("searchMetadataRestore")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "primary",
									disabled: searchSaving,
									onClick: () => void saveSearchEdit(),
									children: t("searchMetadataSave")
								})]
							})
						]
					})
				]
			}),
			(registerOpen || editMcp !== void 0 || editSkill !== void 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LocationModal, {
				remote,
				t: (key, params) => t(key, params),
				defaultKind: activeTab === "skills" ? "skill" : "mcp",
				...editMcp !== void 0 ? { editMcp } : {},
				...editSkill !== void 0 ? { editSkill } : {},
				onClose: () => {
					setRegisterOpen(false);
					setEditMcp(void 0);
					setEditSkill(void 0);
				},
				onChanged: (notice, refreshMcpServer) => {
					if (refreshMcpServer !== void 0) onRefreshMcp(refreshMcpServer);
					else onRefresh();
					if (notice !== void 0) onNotice(notice);
				}
			}),
			catalogDocs !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: () => {
					catalogDocsRequest.current += 1;
					setCatalogDocs(null);
				},
				title: t("viewCatalog"),
				closeLabel: t("previewClose"),
				children: [
					catalogDocs.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-preview-hint",
						children: "…"
					}),
					catalogDocs.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-preview-hint",
						children: catalogDocs.message
					}),
					catalogDocs.status === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-subtabs mc-catalog-tabs",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
							items: [{
								value: "policy",
								id: "mc-cat-tab-policy",
								panelId: "mc-cat-panel-policy",
								label: t("catalogPolicy")
							}, {
								value: "catalog",
								id: "mc-cat-tab-catalog",
								panelId: "mc-cat-panel-catalog",
								label: t("catalogOnDemand")
							}],
							value: catalogTab,
							onChange: setCatalogTab,
							label: t("viewCatalog")
						})
					}), catalogTab === "policy" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "mc-catalog-path",
						children: t("catalogPolicyNote")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "mc-preview-body",
						children: catalogDocs.docs.policyYaml
					})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "mc-catalog-toolbar",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "mc-catalog-path",
								children: t("catalogSearchNote", { count: catalogDocs.docs.onDemand.length })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mc-summary-setting",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: "mc-summary-limit",
										children: t("summaryLimit")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "mc-summary-limit",
										type: "number",
										min: 20,
										step: 1,
										value: summaryLimitDraft,
										disabled: !catalogDocs.docs.searchSettingsEnabled || summaryLimitSaving,
										onChange: (e) => {
											setSummaryLimitDraft(e.target.value);
											setSummaryLimitError(void 0);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("summaryLimitUnit") }),
									catalogDocs.docs.searchSettingsEnabled && summaryLimitDraft !== String(catalogDocs.docs.summaryMaxChars) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "primary",
										disabled: summaryLimitSaving,
										onClick: () => void saveSummaryLimit(),
										children: t("searchMetadataSave")
									}),
									!catalogDocs.docs.searchSettingsEnabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("summaryLimitDisabled") })
								]
							})]
						}),
						summaryLimitError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "mc-error mc-catalog-limit-error",
							children: summaryLimitError
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "mc-preview-body",
							children: [catalogDocs.docs.onDemand.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "mc-preview-hint",
								children: t("catalogEmpty")
							}), catalogDocs.docs.onDemand.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mc-search-result",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "mc-search-result-head",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: row.kind === "tool" ? "Tool" : "Skill" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "mc-search-result-id",
										children: row.id
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "mc-search-result-summary",
									children: row.summary
								})]
							}, `${row.kind}:${row.id}`))]
						})
					] })] })
				]
			})
		]
	});
}
function projectRootForSkill(path) {
	return path.match(/^(.*)\/(?:\.dsh|\.agents)\/skills(?:\/.*)?$/)?.[1] ?? path;
}
function SkillList(props) {
	const { skills, remote, busy, t, onCycle, editableSkills, onEditSkill, onAdoptSkill, onEditSearch } = props;
	/** Skill id whose 纳入管理 is waiting for a confirmation click. */
	const [confirmAdopt, setConfirmAdopt] = (0, react.useState)(null);
	const [openSkill, setOpenSkill] = (0, react.useState)(null);
	const [tree, setTree] = (0, react.useState)({
		open: {},
		dirs: {}
	});
	const [browseErrors, setBrowseErrors] = (0, react.useState)({});
	const [preview, setPreview] = (0, react.useState)(null);
	/** Token for the file-preview read: closing/switching advances it so a late
	*  read cannot re-open a preview the operator already closed. */
	const previewRequest = (0, react.useRef)(0);
	const toggleSkill = (0, react.useCallback)(async (id) => {
		if (openSkill === id) {
			setOpenSkill(null);
			return;
		}
		setOpenSkill(id);
		const key = `${id}:`;
		if (tree.dirs[key] === void 0) try {
			const entries = unwrap(await remote.listSkillDir(id, ""), "capabilityPolicy.listSkillDir");
			if (entries === void 0) setBrowseErrors((prev) => ({
				...prev,
				[key]: t("skillBrowseUnavailable")
			}));
			else setTree((prev) => ({
				...prev,
				dirs: {
					...prev.dirs,
					[key]: entries
				}
			}));
		} catch (error) {
			console.error("[capability-menu] listSkillDir failed:", error);
			setBrowseErrors((prev) => ({
				...prev,
				[key]: String(error)
			}));
		}
	}, [
		openSkill,
		remote,
		t,
		tree.dirs
	]);
	const toggleDir = (0, react.useCallback)(async (id, relPath) => {
		const openKey = `${id}:${relPath}`;
		const nextOpen = !tree.open[openKey];
		setTree((prev) => ({
			...prev,
			open: {
				...prev.open,
				[openKey]: nextOpen
			}
		}));
		if (nextOpen) {
			const key = `${id}:${relPath}`;
			if (tree.dirs[key] === void 0) try {
				const entries = unwrap(await remote.listSkillDir(id, relPath), "capabilityPolicy.listSkillDir");
				if (entries === void 0) setBrowseErrors((prev) => ({
					...prev,
					[key]: t("skillBrowseUnavailable")
				}));
				else setTree((prev) => ({
					...prev,
					dirs: {
						...prev.dirs,
						[key]: entries
					}
				}));
			} catch (error) {
				console.error(`[capability-menu] listSkillDir ${key} failed:`, error);
				setBrowseErrors((prev) => ({
					...prev,
					[key]: String(error)
				}));
			}
		}
	}, [
		remote,
		t,
		tree.dirs,
		tree.open
	]);
	const openPreview = (0, react.useCallback)(async (id, relPath) => {
		const request = previewRequest.current + 1;
		previewRequest.current = request;
		setPreview({
			id,
			relPath
		});
		try {
			const content = unwrap(await remote.readSkillFile(id, relPath), "capabilityPolicy.readSkillFile");
			if (previewRequest.current !== request) return;
			if (content === void 0) setPreview({
				id,
				relPath,
				error: t("notPreviewable")
			});
			else setPreview({
				id,
				relPath,
				content
			});
		} catch (error) {
			if (previewRequest.current !== request) return;
			setPreview({
				id,
				relPath,
				error: String(error)
			});
		}
	}, [remote, t]);
	const renderEntries = (entries, id, base) => {
		if (entries === void 0) return void 0;
		const indent = base.length === 0 ? 0 : base.split("/").length;
		return entries.map((entry) => {
			const relPath = base.length === 0 ? entry.name : `${base}/${entry.name}`;
			if (entry.type === "directory") {
				const openKey = `${id}:${relPath}`;
				const open = tree.open[openKey] ?? false;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "mc-tree-row",
					role: "button",
					tabIndex: 0,
					onClick: () => void toggleDir(id, relPath),
					onKeyDown: (e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							toggleDir(id, relPath);
						}
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "mc-tree-indent",
							style: { width: 8 + indent * 16 }
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "mc-tree-icon",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconTriangleRightFill, {
								size: 10,
								className: `mc-chevron${open ? " mc-chevron--open" : ""}`
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "mc-tree-name",
							children: [entry.name, "/"]
						})
					]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: { marginTop: 2 },
					children: renderEntries(tree.dirs[`${id}:${relPath}`], id, relPath) ?? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mc-tree-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "mc-tree-indent",
							style: { width: 20 + indent * 16 }
						}), "…"]
					})
				})] }, relPath);
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mc-tree-row mc-tree-file",
				role: "button",
				tabIndex: 0,
				title: relPath,
				onClick: () => void openPreview(id, relPath),
				onKeyDown: (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						openPreview(id, relPath);
					}
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "mc-tree-indent",
					style: { width: 8 + indent * 16 }
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "mc-tree-name",
					children: entry.name
				})]
			}, relPath);
		});
	};
	/** The row the 纳入管理 confirmation is for, so the dialog can name it and
	show the directory the click will link. */
	const confirmAdoptRow = confirmAdopt === null ? void 0 : skills.find((row) => row.id === confirmAdopt);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "v3-catgrid",
			children: skills.map((skill) => {
				const open = openSkill === skill.id;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
					className: "v3-group",
					open,
					"data-v3-skill": skill.id,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
						onClick: (e) => {
							e.preventDefault();
							toggleSkill(skill.id);
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
								className: "v3-chev",
								viewBox: "0 0 12 12",
								fill: "none",
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
									d: "M4.5 2.5 8 6l-3.5 3.5",
									stroke: "currentColor",
									strokeWidth: 1.4,
									strokeLinecap: "round",
									strokeLinejoin: "round"
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-gnm",
								children: skill.name
							}),
							PROJECT_SKILL_SOURCES.has(skill.source ?? "") && skill.path !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "v3-cnt",
								title: skill.path,
								children: t("projectRootLabel", { path: projectRootForSkill(skill.path) })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "v3-right",
								children: [
									skill.mandatory && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "v3-tag",
										children: t("mandatory")
									}),
									skill.class === "on-demand" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "v3-tag v3-tag--act",
										title: t("editSearchMetadata"),
										onClick: (e) => {
											e.stopPropagation();
											onEditSearch(skill.id);
										},
										children: t("searchMetadataButton")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "v3-tag",
										"data-tone": CLASS_TONE[skill.class],
										disabled: busy || skill.mandatory,
										title: skill.classLabel,
										onClick: (e) => {
											e.stopPropagation();
											onCycle([skill.id], "skill");
										},
										children: t(CLASS_SHORT_KEYS[skill.class])
									}),
									!editableSkills.has(skill.id) && (skill.preset !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "v3-tag",
										title: t("skillFromPresetHint"),
										children: t("skillFromPreset", { preset: skill.preset })
									}) : ADOPTABLE_SKILL_SOURCES.has(skill.source ?? "") ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "v3-tag v3-tag--act",
										disabled: busy,
										title: t("adoptSkillHint"),
										onClick: (e) => {
											e.stopPropagation();
											setConfirmAdopt(skill.id);
										},
										children: t("adoptSkill")
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "v3-tag",
										title: t("skillSourceHint"),
										children: t("skillSource", { source: sourceLabel(skill.source, t) })
									})),
									editableSkills.has(skill.id) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "v3-tag v3-tag--act",
										disabled: busy,
										onClick: (e) => {
											e.stopPropagation();
											onEditSkill(skill.id, skill.source);
										},
										children: t("edit")
									})
								]
							})
						]
					}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-skill-body",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "mc-tree",
							children: [browseErrors[`${skill.id}:`] !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "mc-preview-hint",
								children: browseErrors[`${skill.id}:`]
							}), renderEntries(tree.dirs[`${skill.id}:`], skill.id, "") ?? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "mc-tree-row",
								children: "…"
							})]
						})
					})]
				}, skill.id);
			})
		}),
		confirmAdopt !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
			open: true,
			onClose: () => setConfirmAdopt(null),
			title: t("adoptSkillTitle", { name: confirmAdoptRow?.name ?? confirmAdopt }),
			closeLabel: t("previewClose"),
			className: "mc-confirm-dialog",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mc-confirm-body",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("adoptSkillHint") }),
					confirmAdoptRow !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "mc-confirm-path",
						children: t("skillSource", { source: confirmAdoptRow.path ?? sourceLabel(confirmAdoptRow.source, t) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mc-confirm-actions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "outline",
							onClick: () => {
								const id = confirmAdopt;
								setConfirmAdopt(null);
								onAdoptSkill(id);
							},
							children: t("adoptSkill")
						})
					})
				]
			})
		}),
		preview !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
			open: true,
			onClose: () => {
				previewRequest.current += 1;
				setPreview(null);
			},
			title: preview.relPath,
			closeLabel: t("previewClose"),
			children: preview.content !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "mc-preview-body",
				children: /\.md$/i.test(preview.relPath) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownFilePreview, {
					text: preview.content,
					t
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: "mc-preview-plain",
					children: preview.content
				})
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "mc-preview-hint",
				children: preview.error ?? "…"
			})
		})
	] });
}
//#endregion
//#region src/client/thinking-throttle.tsx
/**
* 思考节流 — 一个设置入口，内部三个子页：总览 / 思考限制 / 能力菜单。
*
* WHY: 0.3.1 把三个页面注册成三个独立的 settings.section，设置左栏因此多了三条
* 并列入口，看起来不像一个整体功能，也和旧版的「一个页面里切页签」不一致。
* 这里只注册一个入口，外壳负责 v3 标题条 + 页签条，内容区切换复用已有的三个
* 页面组件（各自的数据与交互不变）。
*/
const TAB_ORDER = [
	"overview",
	"guard",
	"capability"
];
const TAB_LABEL = {
	overview: "tabOverview",
	guard: "tabGuard",
	capability: "tabCapability"
};
const SHELL_CSS = [
	".tt-root{display:flex;flex-direction:column;gap:12px;min-width:0}",
	".tt-head{display:flex;flex-direction:column;gap:8px;min-width:0}",
	".tt-title{margin:0;font-size:18px;font-weight:600;line-height:26px;color:var(--v3-t1)}",
	".tt-tabs{display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid var(--v3-line-2);min-width:0}",
	".tt-tab{appearance:none;border:0;background:none;padding:7px 14px 9px;font:inherit;font-size:13px;line-height:20px;color:var(--v3-t3);cursor:pointer;position:relative;border-radius:var(--v3-r-sm) var(--v3-r-sm) 0 0}",
	".tt-tab:hover{color:var(--v3-t1)}",
	".tt-tab[data-active=true]{color:var(--v3-t1);font-weight:600}",
	".tt-tab[data-active=true]:after{content:'';position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--v3-info)}",
	".tt-tab:focus-visible{outline:2px solid var(--v3-info);outline-offset:2px}",
	".tt-body{min-width:0;display:flex;flex-direction:column;gap:12px}"
].join("");
function ThinkingThrottleSection(props) {
	const [active, setActive] = (0, react.useState)("overview");
	const { t } = props;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "v3-root tt-root",
		"data-thinking-throttle": "true",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(V3Styles, {}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", {
				"data-thinking-throttle-style": "true",
				children: SHELL_CSS
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "tt-head",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: "tt-title",
					children: t("title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "tt-tabs",
					role: "tablist",
					"aria-label": t("title"),
					children: TAB_ORDER.map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						className: "tt-tab",
						"data-tab": tab,
						"data-active": active === tab ? "true" : "false",
						"aria-selected": active === tab,
						onClick: () => setActive(tab),
						children: t(TAB_LABEL[tab])
					}, tab))
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "tt-body",
				role: "tabpanel",
				"data-active-tab": active,
				children: [
					active === "overview" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewSection, { ...props.overview }) : null,
					active === "guard" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GuardSection, { ...props.guard }) : null,
					active === "capability" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilitySection, { ...props.capability }) : null
				]
			})
		]
	});
}
/** 外壳文案：zh / en。 */
function thinkingThrottleDictionaries() {
	return {
		zh: {
			nav: "思考节流",
			title: "思考节流",
			tabOverview: "总览",
			tabGuard: "思考限制",
			tabCapability: "能力菜单"
		},
		en: {
			nav: "Thinking Throttle",
			title: "Thinking Throttle",
			tabOverview: "Overview",
			tabGuard: "Thinking Limit",
			tabCapability: "Capability Menu"
		}
	};
}
//#endregion
//#region src/client/index.ts
/** Dictionary namespaces owned by this plugin — one per settings section. */
const NS = "settings.capability";
const GUARD_NS = "settings.thinking-guard";
const OVERVIEW_NS = "settings.thinking-guard-overview";
const SHELL_NS = "settings.thinking-throttle";
/** Required services (cordis fiber inject). `remote.capabilityPolicy` is NOT
*  injected: we mount it in `apply`, so declaring it would deadlock the boot
*  ("waiting for service"). Access it via `ctx.get('remote.capabilityPolicy')`,
*  which resolves the mounted namespace service without the inject gate. */
const inject = [
	"slots",
	"locale",
	"remote"
];
/** Register the 能力菜单 section once `settings.section` is on the ledger. */
function apply(ctx) {
	const zh = {
		nav: "能力菜单",
		title: "能力菜单",
		feedback: "反馈 ↗",
		updateAvailable: "npm 最新版本 v{version}",
		newVersion: "有新版本",
		updateDialogTitle: "能力菜单有新版本",
		updateVersionComparison: "当前版本 v{current}，npm 最新版本 v{latest}。",
		updateNpmNote: "安装更新后，重启 DSH 生效。",
		updateLocalNote: "当前通过本地源码链接安装。你可以继续更新源码，或切换到 npm 版；源码目录不会删除。",
		updateSourceSteps: "查看源码更新步骤",
		updateSourceStepsHide: "收起源码更新步骤",
		updateSourceStepsIntro: "先处理本地未提交的改动，再在源码目录执行：",
		updateSourceStepsRestart: "完成后重启 DSH。npm 的版本号不能反映本地未发布的改动。",
		installUpdate: "安装更新",
		switchAndInstall: "切换并安装 npm 版",
		updatingPlugin: "正在更新能力菜单…",
		pluginUpdated: "更新完成，重启 DSH 后生效。",
		pluginSwitched: "已切换并安装 npm 版，重启 DSH 后生效。",
		pluginNonRegistrySource: "当前不是从 npm 仓库安装，请按原来源更新。",
		pluginProfileUnavailable: "无法确定当前 DSH profile，请使用 DSH 命令更新。",
		pluginUpdateFailed: "更新失败：",
		desc: "统一管理工具与技能的启用方式，并提供执行保护与运行统计。",
		resident: "常驻上下文",
		"on-demand": "按需发现",
		disabled: "禁用",
		tool: "工具",
		skill: "技能",
		mandatory: "控制面",
		toolsGroup: "工具",
		skillsGroup: "技能",
		builtInGroup: "系统内置",
		globalSkills: "全局技能",
		projectSkills: "项目技能",
		presetSkills: "预设技能",
		emptyGlobalSkills: "暂无全局技能",
		emptyProjectSkills: "暂无项目技能",
		emptyPresetSkills: "暂无预设技能",
		filterByName: "按名字、分组或正则过滤…",
		filterHint: "忽略大小写。可匹配工具名、技能名、MCP 服务器、技能来源与预设编号，也支持正则，例如 cordis|ptc。",
		filterNoMatch: "没有匹配的能力（清空过滤框可恢复完整列表）",
		emptyTools: "暂无工具",
		emptySkills: "暂无技能",
		toolCount: "{count} 个工具",
		residentShort: "常驻",
		onDemandShort: "按需",
		disabledShort: "禁用",
		cycleHint: "点击标签切换分类（按需 → 禁用 → 常驻）",
		notPreviewable: "该文件不是可预览的文本文件",
		previewClose: "关闭",
		markdownCode: "代码",
		markdownWrap: "自动换行",
		markdownUnwrap: "不换行",
		markdownCopy: "复制",
		markdownCopied: "已复制",
		markdownFootnotes: "脚注",
		detailNotFound: "未找到该工具的详情",
		cycleSaved: "已保存：{name} → {tier}",
		cycleOverridden: "分类未生效：{count} 个能力被更高优先级规则覆盖（如通配规则），可移除对应通配规则后重试",
		refreshFailed: "刷新失败，请查看日志",
		mcpToolsPending: "已注册「{name}」，但暂未加载出工具。请检查连接和认证后点刷新。",
		retry: "重试",
		carrierFailureHint: "请求未到达服务端：浏览器与 dsh 之间的连接已断开（Failed to fetch 属传输层失败，服务端方法未执行）。若刚重启过 dsh web，请先硬刷新页面（Ctrl/Cmd+Shift+R）再重试。",
		registerCapability: "注册能力",
		editMcp: "编辑 MCP 服务器",
		editSkillNamed: "编辑技能目录：{name}",
		edit: "编辑",
		save: "保存",
		remove: "移除",
		cancel: "取消",
		confirmRemove: "确认移除",
		confirmRemoveMcp: "移除 MCP 服务器「{name}」？其 patch 文件中的配置行（含 headers、环境变量）将被删除，mcp__{name}__* 工具随之消失。",
		confirmRemoveSkillLink: "移除技能「{name}」？仅删除 ~/.dsh/skills 下的软链，源目录不受影响。",
		confirmRemoveSkillDir: "移除技能「{name}」？该项位于 ~/.dsh/skills 下且非软链，将连同文件递归删除，且不可恢复。",
		confirmSaveAnyway: "仍然保存",
		saveConfirmRealDir: "「{name}」这个条目是真实目录、不是软链：保存会先把它连同文件递归删除，再改为指向新路径，且不可恢复。",
		register: "注册",
		notEditable: "该项未在注册表中（可能是项目技能或内置技能），无法编辑。",
		entryNotFound: "目标已不存在，可能已被移除。",
		mcpServers: "MCP 服务器",
		skillDirs: "技能目录",
		skillUpdates: "技能更新",
		skillCheckProgress: "正在检查 {name}，{done}/{total}",
		skillCheckComplete: "已检查 {total} 个：{available} 个可更新、{unmanaged} 个未关联、{failed} 个失败",
		skillUpdatingItem: "正在更新 {name}，{done}/{total}",
		skillUpdateComplete: "更新完成：成功 {succeeded} 个，失败 {failed} 个",
		skillAssociatingItem: "正在关联 {name}；旧版本可能需要搜索历史",
		skillUnlinking: "正在解除 {name} 的来源关联",
		skillUnlinked: "已解除来源关联，技能文件保留",
		skillAssociated: "来源关联成功",
		skillSourceFailed: "来源操作失败，详情见对应技能",
		skillAvailableCount: "可更新：{count}",
		skillWaiting: "已等待 {seconds} 秒，请稍候…",
		skillGitManaged: "由 Git 管理，请通过 Git 更新",
		skillEditSource: "修改来源",
		skillUnlinkSource: "解除关联",
		skillErrorDetails: "查看技术详情",
		skillCheckUpdates: "检查更新",
		skillUpdateAll: "全部更新（{count}）",
		skillChecking: "正在检查…",
		skillUpdating: "正在更新…",
		skillInstalledRevision: "当前提交：{revision}",
		skillLatestRevision: "最新提交：{revision}",
		skillUpToDate: "已是最新",
		skillLocalModified: "含本地修改，已暂停自动更新",
		skillUpdateAvailable: "有更新",
		skillChangedFiles: "变更文件（{count}）",
		skillViewChanges: "查看上游变更",
		skillUpdateOne: "更新",
		skillUpdateProgress: "{done}/{total}",
		skillAssociating: "正在关联来源…",
		skillSourceUrl: "GitHub 来源链接",
		skillAssociateSource: "关联来源",
		skillAssociateHint: "未关联来源的技能尚未检查更新。输入原 GitHub 链接，可匹配当前或历史版本；本地改动不会被覆盖。",
		skillDirPath: "技能来源路径",
		skillRoot: "技能位置",
		skillRootUser: "全局技能（~/.dsh/skills）",
		skillRootProject: "项目技能（<项目根>/.dsh/skills）",
		skillRootHintUser: "所有会话都能看到该技能。",
		skillRootHintProject: "只对 cwd 落在该项目内的会话可见。",
		skillProjectPath: "目标项目路径",
		skillProjectPathHint: "项目内任意一个已存在的路径即可；项目根按 dsh 的规则确定（向上找最近的 .git），技能写进 <项目根>/.dsh/skills。",
		skillRegisteredAt: "已注册到 {path}",
		skillRepointed: "已改为指向 {dir}",
		skillAdopted: "已纳入管理：{path}",
		skillSource: "来源：{source}",
		skillSourceHint: "该技能由 dsh 从其它根发现，不在本插件管理的技能目录里，因此没有「编辑」。",
		skillFromPreset: "来自预设 {preset}",
		skillFromPresetHint: "该技能随 agent preset 分发，只对挂载了该预设的会话可见；不能纳入管理（那会把它软链进全局技能根，对所有会话生效）。",
		githubImporting: "正在从 GitHub 获取并校验 Skill，完成后会自动注册…",
		importing: "导入中…",
		skillUnmanaged: "未纳入管理",
		sourceCustom: "自定义技能目录",
		sourceBundled: "随 dsh 预置",
		adoptSkill: "纳入管理",
		adoptSkillHint: "仅用户级自定义来源可纳入管理；会把它软链进 dsh 的技能根目录（默认 ~/.dsh/skills），内容不动。",
		adoptSkillTitle: "纳入管理「{name}」？",
		skillDirHint: "支持本机目录或公开 GitHub HTTPS 技能链接。GitHub 导入会校验 SKILL.md，并只保留对应技能目录；运行 dsh 的机器需安装 Git。技能名取自 SKILL.md。",
		serverName: "服务器名称",
		serverNameImmutable: "名称用于工具 ID 和权限规则，注册后不可更改。",
		transport: "传输方式",
		transportStdio: "本地子进程",
		transportHttp: "HTTP MCP 端点",
		transportHintStdio: "由客户端将该 MCP server 作为子进程启动，JSON-RPC 报文经标准输入 / 输出交换。",
		transportHintHttp: "客户端通过支持 POST/GET 的 MCP 端点连接。",
		command: "命令",
		args: "参数（空格分隔）",
		cwd: "工作目录",
		env: "环境变量",
		url: "地址",
		headers: "请求头",
		headersHint: "每行一个请求头，格式为「名称: 值」；令牌等认证信息填在这里。",
		timeout: "超时（秒）",
		timeoutInvalid: "超时须为数字，单位为秒。",
		viewCatalog: "策略与目录",
		catalogPolicy: "能力暴露规则",
		catalogOnDemand: "按需检索目录",
		catalogPolicyNote: "当前生效规则（只读）；未匹配规则的能力默认常驻。",
		catalogSearchNote: "与按需检索共用索引 · 按需能力 {count} 项",
		catalogEmpty: "当前没有按需能力。",
		editSearchMetadata: "编辑检索描述",
		searchMetadataButton: "检索描述",
		searchDescription: "检索描述",
		searchMetadataNote: "这里修改按需检索文字，不会改变能力来源的原始定义。",
		searchMetadataSave: "保存",
		searchMetadataRestore: "还原",
		searchMetadataRestoreHint: "还原为来源描述；点击保存后生效",
		searchMetadataSaved: "检索描述已保存",
		summaryLimit: "检索描述上限",
		summaryLimitUnit: "字符",
		summaryLimitInvalid: "请输入不小于 20 的整数",
		summaryLimitDisabled: "检索信息存储未启用",
		summaryLimitSaved: "检索描述上限已保存",
		diagnosticTitle: "能力诊断：{count} 项",
		diagnosticUnavailable: "不可调用：{name}（来源 {source}{preset}）",
		diagnosticShadowed: "同名覆盖：{name} 保留 {winner}，隐藏 {hidden}",
		diagnosticBroken: "损坏的 preset：{id}（{reason}；受影响技能数量由 DSH 未提供）",
		diagnosticUnbrowseable: "不可浏览：{name}（{reason}）",
		diagnosticUndocumented: "描述待补：{name}；摘要回退为「{summary}」",
		projectRootLabel: "项目根：{path}",
		skillBrowseUnavailable: "该技能没有可浏览的目录根，可能是非目录型技能来源。"
	};
	const en = {
		nav: "Capability Menu",
		title: "Capability Menu",
		feedback: "Feedback ↗",
		updateAvailable: "Latest on npm: v{version}",
		newVersion: "New version",
		updateDialogTitle: "Capability Menu update available",
		updateVersionComparison: "Current version v{current}; latest on npm v{latest}.",
		updateNpmNote: "Restart DSH after installing the update.",
		updateLocalNote: "This is linked to local source. You can update the source or switch this profile to the npm release. The source directory will be kept.",
		updateSourceSteps: "Show source update steps",
		updateSourceStepsHide: "Hide source update steps",
		updateSourceStepsIntro: "Resolve uncommitted changes first, then run these commands in the source directory:",
		updateSourceStepsRestart: "Restart DSH afterward. The npm version number does not account for unpublished local changes.",
		installUpdate: "Install update",
		switchAndInstall: "Switch and install npm release",
		updatingPlugin: "Updating Capability Menu…",
		pluginUpdated: "Update complete. Restart DSH to apply it.",
		pluginSwitched: "Switched to the npm release. Restart DSH to apply it.",
		pluginNonRegistrySource: "This is not an npm registry install. Update it from its original source.",
		pluginProfileUnavailable: "Cannot identify the active DSH profile. Update with the DSH CLI.",
		pluginUpdateFailed: "Update failed:",
		desc: "Manage exposure rules and search information for tools and skills.",
		resident: "Resident",
		"on-demand": "On-demand",
		disabled: "Disabled",
		tool: "工具",
		skill: "技能",
		mandatory: "控制面",
		toolsGroup: "工具",
		skillsGroup: "技能",
		builtInGroup: "System built-in",
		globalSkills: "Global skills",
		projectSkills: "Project skills",
		presetSkills: "Preset skills",
		emptyGlobalSkills: "No global skills",
		emptyProjectSkills: "No project skills",
		emptyPresetSkills: "No preset skills",
		filterByName: "Filter by name, group, or regex…",
		filterHint: "Case-insensitive. Matches tool/skill names, MCP servers, skill source labels and preset ids; a regular expression works too, e.g. cordis|ptc or /^mcp__dbx/.",
		filterNoMatch: "No capability matches (clear the filter to see the full list)",
		emptyTools: "No tools",
		emptySkills: "No skills",
		toolCount: "{count} tools",
		residentShort: "Resident",
		onDemandShort: "On-demand",
		disabledShort: "Disabled",
		cycleHint: "Click a tag to cycle its classification (On-demand → Disabled → Resident)",
		notPreviewable: "This file is not a previewable text file",
		previewClose: "Close",
		markdownCode: "Code",
		markdownWrap: "Wrap",
		markdownUnwrap: "Unwrap",
		markdownCopy: "Copy",
		markdownCopied: "Copied",
		markdownFootnotes: "Footnotes",
		detailNotFound: "Tool detail not found",
		cycleSaved: "Saved: {name} → {tier}",
		cycleOverridden: "Classification not applied: {count} capability(ies) overridden by a higher-priority rule (e.g. a wildcard). Remove the matching wildcard rule and retry.",
		refreshFailed: "Refresh failed; see the log",
		mcpToolsPending: "\"{name}\" is registered, but its tools have not loaded yet. Check its connection and authentication, then refresh.",
		retry: "Retry",
		carrierFailureHint: "The request never reached the server: the browser connection to dsh is broken (\"Failed to fetch\" is a transport failure, so no server method ran). If dsh web was just restarted, hard-refresh the page (Ctrl/Cmd+Shift+R) and retry.",
		registerCapability: "Register",
		editMcp: "Edit MCP server",
		editSkillNamed: "Edit skill directory: {name}",
		edit: "Edit",
		save: "Save",
		remove: "Remove",
		cancel: "Cancel",
		confirmRemove: "Confirm removal",
		confirmRemoveMcp: "Remove the MCP server \"{name}\"? Its config row in the patch file (headers and environment included) is deleted, and the mcp__{name}__* tools disappear with it.",
		confirmRemoveSkillLink: "Unregister the skill \"{name}\"? Only the symlink under ~/.dsh/skills is removed; the source directory is left untouched.",
		confirmRemoveSkillDir: "Remove the skill \"{name}\"? It sits under ~/.dsh/skills and is not a symlink, so it will be deleted recursively with all of its files. This cannot be undone.",
		confirmSaveAnyway: "Save anyway",
		saveConfirmRealDir: "The entry \"{name}\" is a real directory, not a symlink: saving deletes it and its files recursively before repointing it, and that cannot be undone.",
		register: "Register",
		notEditable: "This entry is not in the registry (a project or bundled skill), so it cannot be edited.",
		entryNotFound: "The target no longer exists; it may have been removed.",
		mcpServers: "MCP servers",
		skillDirs: "Skill directories",
		skillUpdates: "Skill updates",
		skillCheckProgress: "Checking {name}, {done}/{total}",
		skillCheckComplete: "Checked {total}: {available} updates, {unmanaged} unlinked, {failed} failed",
		skillUpdatingItem: "Updating {name}, {done}/{total}",
		skillUpdateComplete: "Update complete: {succeeded} succeeded, {failed} failed",
		skillAssociatingItem: "Linking {name}; older snapshots may require a history search",
		skillUnlinking: "Unlinking the source of {name}",
		skillUnlinked: "Source unlinked; Skill files preserved",
		skillAssociated: "Source linked successfully",
		skillSourceFailed: "Source operation failed; see the Skill for details",
		skillAvailableCount: "Updates available: {count}",
		skillWaiting: "Elapsed: {seconds} seconds. Please wait…",
		skillGitManaged: "Managed by Git; update using Git",
		skillEditSource: "Edit source",
		skillUnlinkSource: "Unlink source",
		skillErrorDetails: "Technical details",
		skillCheckUpdates: "Check updates",
		skillUpdateAll: "Update all ({count})",
		skillChecking: "Checking…",
		skillUpdating: "Updating…",
		skillInstalledRevision: "Installed commit: {revision}",
		skillLatestRevision: "Latest commit: {revision}",
		skillUpToDate: "Up to date",
		skillLocalModified: "Local changes; automatic update paused",
		skillUpdateAvailable: "Update available",
		skillChangedFiles: "Changed files ({count})",
		skillViewChanges: "View upstream changes",
		skillUpdateOne: "Update",
		skillUpdateProgress: "{done}/{total}",
		skillAssociating: "Linking source…",
		skillSourceUrl: "GitHub source URL",
		skillAssociateSource: "Link source",
		skillAssociateHint: "Unlinked Skills have not been checked for updates. Enter the original GitHub URL to match a current or historical snapshot; local edits are preserved.",
		skillDirPath: "Skill source path",
		skillRoot: "Skill location",
		skillRootUser: "Global (~/.dsh/skills)",
		skillRootProject: "Project (<projectRoot>/.dsh/skills)",
		skillRootHintUser: "Visible to every session.",
		skillRootHintProject: "Visible only to sessions whose cwd sits inside that project.",
		skillProjectPath: "Target project path",
		skillProjectPathHint: "Any existing path inside the project; the project root is derived the way dsh derives it (nearest .git above it) and the skill is written under <projectRoot>/.dsh/skills.",
		skillRegisteredAt: "Registered at {path}",
		skillRepointed: "Repointed to {dir}",
		skillAdopted: "Adopted: {path}",
		skillSource: "Source: {source}",
		skillSourceHint: "dsh found this skill in another root, not in a skill directory this plugin manages, so there is no Edit button.",
		skillFromPreset: "From preset {preset}",
		skillFromPresetHint: "This skill ships with an agent preset and is visible only to sessions that mount it. It cannot be adopted (adopting would link it into the global skill root, making it apply to every session).",
		githubImporting: "Fetching and validating the Skill from GitHub… It will register automatically when complete.",
		importing: "Importing…",
		skillUnmanaged: "Not managed here",
		sourceCustom: "custom skill dirs",
		sourceBundled: "bundled with dsh",
		adoptSkill: "Adopt",
		adoptSkillHint: "Only user-agents and custom sources can be adopted. This links it into dsh's skill root (default ~/.dsh/skills); the content is untouched.",
		adoptSkillTitle: "Adopt \"{name}\"?",
		skillDirHint: "Enter a local directory or a public GitHub HTTPS skill URL. Imports validate SKILL.md and keep only the selected skill directory. Git must be installed on the machine running dsh. The skill name comes from SKILL.md.",
		serverName: "服务器名称",
		serverNameImmutable: "The name is locked after registration because tool IDs and permission rules use it.",
		transport: "Transport",
		transportStdio: "stdio (local subprocess)",
		transportHttp: "streamable-http (HTTP MCP endpoint)",
		transportHintStdio: "The client launches the MCP server as a subprocess and exchanges JSON-RPC messages over its standard input and output.",
		transportHintHttp: "Connect through the MCP endpoint URL (supports POST and GET).",
		command: "Command",
		args: "Args (space separated)",
		cwd: "Working directory",
		env: "Environment",
		url: "地址",
		headers: "Headers",
		headersHint: "One header per line as Key: Value; credentials such as a Bearer token go here.",
		timeout: "Timeout (seconds)",
		timeoutInvalid: "Timeout must be a number of seconds.",
		viewCatalog: "Policy & catalog",
		catalogPolicy: "Exposure rules",
		catalogOnDemand: "On-demand search catalog",
		catalogPolicyNote: "Effective rules (read only). Unmatched capabilities default to Resident.",
		catalogSearchNote: "Shared in-memory index with meta_search · {count} On-demand capabilities",
		catalogEmpty: "No On-demand capabilities.",
		editSearchMetadata: "Edit search description",
		searchMetadataButton: "Search description",
		searchDescription: "Search description",
		searchMetadataNote: "This changes the on-demand search text, not the provider definition.",
		searchMetadataSave: "Save",
		searchMetadataRestore: "Restore",
		searchMetadataRestoreHint: "Restore the provider description; save to apply",
		searchMetadataSaved: "Search description saved",
		summaryLimit: "Search description limit",
		summaryLimitUnit: "characters",
		summaryLimitInvalid: "Enter an integer of at least 20",
		summaryLimitDisabled: "Search information storage is disabled",
		summaryLimitSaved: "Search description limit saved",
		diagnosticTitle: "Capability diagnostics: {count} items",
		diagnosticUnavailable: "Not invocable: {name} (source {source}{preset})",
		diagnosticShadowed: "Name collision: {name} keeps {winner}; hidden from {hidden}",
		diagnosticBroken: "Broken preset: {id} ({reason}; DSH does not provide the affected skill count)",
		diagnosticUnbrowseable: "Cannot browse: {name} ({reason})",
		diagnosticUndocumented: "Description needed: {name}; search summary falls back to “{summary}”.",
		projectRootLabel: "Project root: {path}",
		skillBrowseUnavailable: "This Skill has no browsable directory root; its provider may be non-filesystem based."
	};
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "capability-menu: dictionaries");
	ctx.effect(() => ctx.locale.register(GUARD_NS, guardDictionaries()), "thinking-guard: dictionaries");
	ctx.effect(() => ctx.locale.register(OVERVIEW_NS, overviewDictionaries()), "thinking-guard: overview dictionaries");
	ctx.effect(() => ctx.locale.register(SHELL_NS, thinkingThrottleDictionaries()), "thinking-throttle: dictionaries");
	const remoteMount = createRemoteMount(() => ctx.remote.$mount(TYPERT_REMOTE), () => ctx.get("remote.capabilityPolicy"));
	ctx.effect(() => remoteMount.dispose, "capability-menu: remote mount");
	/**
	* `$mount` for the Guard's own namespace (`thinkingGuard`).
	*
	* A second, separate contribution: the Guard face belongs to this package, the
	* capability face belongs to the upstream package, and a Typert contribution
	* carries exactly one package id. Mounting both from this entry is what keeps
	* the two wire namespaces independent (task item 3).
	*/
	const guardMount = createRemoteMount(() => ctx.remote.$mount(TYPERT_GUARD_REMOTE), () => ctx.get("remote.thinkingGuard"));
	ctx.effect(() => guardMount.dispose, "thinking-guard: guard remote mount");
	/**
	* Resolve a mounted namespace, waiting for the contribution to finish mounting.
	*
	* `apply` is synchronous, so the namespace may not exist yet when the settings
	* shell builds the section props. Every remote method is async anyway, so the
	* proxies below await this instead of handing the section a half-mounted face
	* (which would surface as a transport error the user would read as a bug).
	*/
	const awaitMount = async (mount, what) => {
		const ready = () => {
			const snapshot = mount.getSnapshot();
			return snapshot.status === "ready" ? snapshot.remote : void 0;
		};
		const current = ready();
		if (current !== void 0) return current;
		await new Promise((resolve, reject) => {
			const stop = mount.subscribe(() => {
				const snapshot = mount.getSnapshot();
				if (snapshot.status === "loading") return;
				stop();
				if (snapshot.status === "ready") resolve();
				else reject(/* @__PURE__ */ new Error(what + ": " + snapshot.error));
			});
		});
		const remote = ready();
		if (remote === void 0) throw new Error(what + ": remote unavailable after mounting");
		return remote;
	};
	/** A remote face that resolves its mounted namespace on every call. */
	const lazyRemote = (mount, what) => new Proxy({}, { get(_target, property) {
		if (typeof property !== "string") return void 0;
		return async (...args) => {
			const remote = await awaitMount(mount, what);
			const member = remote[property];
			if (typeof member !== "function") throw new Error(what + " has no method " + property);
			return member.apply(remote, args);
		};
	} });
	const capabilityRemote = lazyRemote(remoteMount, "capabilityPolicy");
	const guardRemote = lazyRemote(guardMount, "thinkingGuard");
	const t = ctx.locale.bind(NS);
	installSettingsNavIcon(ctx, () => t("nav"));
	/**
	* The two signals that say "the host catalog may have moved, and this page did
	* not ask": a settings document edit, and a carrier reconnect.
	*
	* `settings/document-updated` is one of the events dsh forwards to browsers
	* (so it arrives over the same validated channel as the remote calls) and it
	* fires for external edits too — composition files are edited outside the
	* browser, and nothing else on the wire announces that. `connection/reset` is
	* the client's own reconnect signal rather than a forwarded one, which is why
	* it is a plain local `ctx.on`; dsh's own settings sections listen to exactly
	* this pair, including the first connection, which closes the window where a
	* change lands between the initial read and the subscription.
	*
	* Neither subscription is fatal: the section falls back to its version poll.
	*/
	const subscribeSignals = (listener) => {
		const disposers = [];
		const forwarded = ctx.remote;
		try {
			if (typeof forwarded.$on !== "function") throw new Error("ctx.remote.$on is unavailable");
			disposers.push(forwarded.$on("settings/document-updated", () => listener()));
		} catch (error) {
			console.error("[capability-menu] settings/document-updated subscription failed:", error);
		}
		try {
			disposers.push(ctx.on("connection/reset", () => listener()));
		} catch (error) {
			console.error("[capability-menu] connection/reset subscription failed:", error);
		}
		return () => {
			for (const dispose of disposers) dispose();
		};
	};
	/**
	* Props for the v3 capability section.
	*
	* `remote` is what the view actually calls (its data layer, ported from 0.1.27,
	* owns the retry/loading states itself). `remoteMount` rides along unchanged
	* from the upstream registration: it is the observable mount lifecycle, and
	* keeping it wired is what the activation test and any diagnostics read.
	*/
	const injected = () => {
		return {
			remote: capabilityRemote,
			remoteMount,
			t,
			subscribeSignals
		};
	};
	const shellT = ctx.locale.bind(SHELL_NS);
	const overviewT = ctx.locale.bind(OVERVIEW_NS);
	const guardT = ctx.locale.bind(GUARD_NS);
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "thinking-throttle",
		order: 12,
		label: () => shellT("nav"),
		locale: SHELL_NS,
		inject: () => ({
			t: shellT,
			remoteMount,
			capability: injected(),
			overview: {
				guardRemote,
				capabilityRemote,
				t: overviewT
			},
			guard: {
				remote: guardRemote,
				t: guardT
			}
		})
	}, ThinkingThrottleSection));
	remoteMount.start();
	guardMount.start();
}
//#endregion
exports.apply = apply;
exports.inject = inject;


return module.exports;
}});