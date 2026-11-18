'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require request';
'require carbon.markdown as markdown';

/*
 * System → Carbon Theme Settings.
 * 【修改版：移除全部在线升级功能，仅保留自定义Logo + 镜像设置】
 */
const call = (method, params) => rpc.declare({ object: 'luci.carbon_update', method: method, params: params, expect: { '': {} }, raise: true });
const status = call('status');
const configure = call('configure', [ 'mirror' ]);
const setLogo = call('logo', [ 'action' ]);

/* Must match the rpcd backend and its ACL (the only file cgi-upload may write). */
const LOGO_UPLOAD = '/tmp/carbon-logo.upload';
const LOGO_MAX = 262144;
const LOGO_DEFAULT = '/luci-static/carbon/logo.svg';
const LOGO_TYPES = /^image\/(png|jpeg|gif|webp|svg\+xml)$/;
const LOGO_NAMES = /\.(png|jpe?g|gif|webp|svg)$/i;
const MIRROR_RE = /^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(\/[A-Za-z0-9._~%+-]+)*\/?$/;

const N_ = s => s;
const tr = (s, ...args) => (window.Carbon && typeof window.Carbon.t === 'function') ?
	window.Carbon.t(s, ...args) : (args.length ? _(s).format(...args) : _(s));
const errors = {
	/* logo */
	logo_missing: N_('The uploaded file did not reach the router. Try again.'),
	logo_size: N_('The logo must be at most 256 KB.'),
	logo_type: N_('Unsupported file. Use a PNG, JPEG, WebP, GIF or SVG image.'),
	logo_unsafe: N_('This SVG contains scripts, event handlers, links or embedded documents and was rejected. Save it as a plain SVG or PNG.'),
	logo_denied: N_('Permission denied. Log out and log in again once after updating Carbon, then retry.'),
	invalid_mirror: N_('Enter an HTTPS mirror prefix such as https://mirror.example.com/ (letters, digits and . _ ~ % + - only).'),
};
const message = code => errors[code] ? tr(errors[code]) : String(code || '');
const writable = () => L.hasViewPermission();

const section = (title, description, children) => E('section', { 'class': 'cbi-section' },
	[E('h3', {}, [].concat(title))].concat(description ? [E('p', { 'class': 'cbi-section-descr' }, description)] : [], children));
let hintSeq = 0;
function hint(text) {
	const id = 'cb-hint-' + (++hintSeq);
	let wrap = null;
	const outside = (e) => { if (!wrap.contains(e.target)) setOpen(false); };
	const setOpen = (on) => {
		wrap.classList.toggle('open', on);
		button.setAttribute('aria-expanded', on ? 'true' : 'false');
		if (on) document.addEventListener('pointerdown', outside, true);
		else document.removeEventListener('pointerdown', outside, true);
	};
	const button = E('button', {
		'type': 'button', 'class': 'cb-hint-btn', 'aria-label': tr('About this setting'),
		'aria-describedby': id, 'aria-expanded': 'false',
		'click': () => setOpen(!wrap.classList.contains('open')),
		'keydown': (e) => { if (e.key === 'Escape') setOpen(false); }
	}, ['?']);
	wrap = E('span', { 'class': 'cb-hint' }, [button, E('span', { 'class': 'cb-hint-bubble', 'id': id, 'role': 'tooltip' }, [text])]);
	return wrap;
}
const actions = (children) => E('div', { 'class': 'cb-update-actions' }, children);
const external = (href, text) => E('a', { 'href': href, 'target': '_blank', 'rel': 'noopener noreferrer' }, text);

/* ---- custom logo: preview, upload, restore default ---- */
function logoSection(data) {
	let logoUrl = data.logo || '';
	const preview = E('img', { 'class': 'cb-logo-preview', 'alt': tr('Current logo') });
	const state = E('span', { 'class': 'cb-update-note', 'role': 'status', 'aria-live': 'polite' });
	const input = E('input', {
		'type': 'file', 'id': 'carbon-logo-file', 'hidden': true,
		'accept': 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg',
		'change': () => {
			const file = input.files && input.files[0];
			input.value = '';
			if (!file) return;
			if (!LOGO_TYPES.test(file.type) && !LOGO_NAMES.test(file.name)) { state.textContent = message('logo_type'); return; }
			if (!file.size || file.size > LOGO_MAX) { state.textContent = message('logo_size'); return; }
			return apply(() => upload(file), tr('Logo saved.'));
		}
	});
	const uploadButton = E('button', { 'class': 'cbi-button cbi-button-action', 'click': () => input.click() }, tr('Upload logo…'));
	const resetButton = E('button', { 'class': 'cbi-button cbi-button-reset', 'click': () => apply(() => setLogo('reset'), tr('The default logo is restored.')) }, tr('Restore default'));

	const paint = () => {
		const src = logoUrl || LOGO_DEFAULT;
		preview.src = src;
		uploadButton.disabled = !writable();
		resetButton.disabled = !logoUrl || !writable();
		document.querySelectorAll('.cb-brand-logo, .cb-hero-icon img').forEach((img) => {
			img.src = src;
			if (logoUrl) img.setAttribute('data-custom', ''); else img.removeAttribute('data-custom');
		});
		document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((link) => {
			link.href = src;
			if (logoUrl) link.removeAttribute('type');
		});
	};
	async function upload(file) {
		const form = new FormData();
		form.append('sessionid', rpc.getSessionID());
		form.append('filename', LOGO_UPLOAD);
		form.append('filedata', file);
		const res = await request.post(L.env.cgi_base + '/cgi-upload', form, { timeout: 0 });
		if (res.status === 403) return { error: 'logo_denied' };
		if (!res.ok) throw new Error(res.statusText || ('HTTP ' + res.status));
		return setLogo('set');
	}
	async function apply(action, done) {
		uploadButton.disabled = resetButton.disabled = true;
		state.textContent = tr('Saving…');
		try {
			const result = await action();
			if (result.error) state.textContent = message(result.error);
			else { logoUrl = result.logo || ''; state.textContent = done; }
		}
		catch (e) { state.textContent = e.message; }
		paint();
	}
	paint();

	return section(tr('Logo'), tr('Shown in the sidebar, on the login page, on the overview and as the browser icon. PNG, JPEG, WebP, GIF or SVG up to 256 KB; a square image of at least 128 × 128 pixels looks best. The logo is kept across theme updates and firmware upgrades that keep settings.'), [
		E('div', { 'class': 'cb-logo-row' }, [preview, E('div', { 'class': 'cb-logo-actions' }, [uploadButton, resetButton, input, state])])
	]);
}

/* ---- download mirror（保留入口，只是不再用于在线升级） ---- */
function mirrorSection(data) {
	const input = E('input', {
		'class': 'cbi-input-text', 'id': 'carbon-mirror', 'type': 'url', 'inputmode': 'url', 'maxlength': '200',
		'placeholder': 'https://mirror.example.com/', 'spellcheck': 'false', 'autocomplete': 'off', 'value': data.mirror || ''
	});
	const state = E('span', { 'class': 'cb-update-note', 'role': 'status', 'aria-live': 'polite' });
	const save = E('button', { 'class': 'cbi-button cbi-button-save', 'click': async () => {
		const value = input.value.trim();
		if (value && !MIRROR_RE.test(value)) { state.textContent = message('invalid_mirror'); return; }
		save.disabled = true;
		try {
			const result = await configure(value);
			if (result.error) state.textContent = message(result.error);
			else {
				input.value = result.mirror || '';
				state.textContent = tr('Saved.');
			}
		}
		catch (e) { state.textContent = e.message; }
		finally { save.disabled = !writable(); }
	} }, tr('Save'));
	if (!writable()) { input.disabled = true; save.disabled = true; }

	return section([tr('Download mirror'), hint(tr('Mirror setting preserved. Online theme upgrade function has been disabled.'))], null, [
		E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title', 'for': 'carbon-mirror' }, tr('Mirror prefix')),
			E('div', { 'class': 'cbi-value-field cb-update-field' }, [input, save, state])
		])
	]);
}

return view.extend({
	load() { return status(); },
	render(data) {
		// 移除 poll 轮询、移除updateSections升级整套UI
		return E('div', { 'class': 'cbi-map cb-update' }, [
			E('h2', {}, tr('Carbon Theme Settings')),
			E('p', { 'class': 'cbi-map-descr' }, tr('Personalise the logo. Online theme upgrade function is disabled.')),
			logoSection(data),
			mirrorSection(data)
		]);
	},
	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
