(function() {
	const e = performance.now();
	let t = !1;
	try {
		const e = new OffscreenCanvas(1, 1), n = e.getContext("webgl2") || e.getContext("webgl");
		t = !!n;
		const o = n && n.getExtension("WEBGL_lose_context");
		o && o.loseContext();
	} catch (n) {
		t = !1;
	}
	self.postMessage({
		type: "GL_WARM_DONE",
		ok: t,
		ms: performance.now() - e
	});
})();
