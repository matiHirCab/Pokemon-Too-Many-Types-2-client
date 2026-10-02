'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// This reads immutable, already-decoded artwork identified by the reviewed pin.
// It neither fetches assets nor trusts dimensions/paths from a supplied manifest.
function readRegular(filename, limit) {
	for (let at = path.resolve(filename); at !== path.dirname(at); at = path.dirname(at)) {
		if (fs.lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('Artwork symlink refused');
	}
	const stat = fs.lstatSync(filename);
	if (!stat.isFile() || stat.size > limit) throw Error('Invalid artwork file/size');
	return fs.readFileSync(filename);
}

function loadArtwork(directory, pin) {
	const manifest = readRegular(path.join(directory, 'manifest.json'), 65536);
	if (hash(manifest) !== pin.manifestSha256) throw Error('Artwork manifest mismatch');
	const parsed = JSON.parse(manifest);
	if (!parsed.complete || parsed.files.length !== pin.files.length) throw Error('Incomplete artwork');
	const outputs = {};
	const files = {};
	for (const file of pin.files) {
		const allowed = /^sprites\/(?:ani(?:-back)?\/[a-z0-9]+\.gif|trainers\/(?:rosa|lyra)\.png|pokemonicons(?:-pokeball)?-sheet\.png)$/;
		if (!allowed.test(file.path)) {
			throw Error('Unsafe pinned artwork path');
		}
		if (files[file.path]) throw Error('Duplicate pinned artwork');
		const bytes = readRegular(path.join(directory, file.path), 8 * 1024 * 1024);
		if (bytes.length !== file.sizeBytes || hash(bytes) !== file.sha256) throw Error(`Artwork bytes mismatch: ${file.path}`);
		const target = `tmt2/${file.path}`;
		outputs[target] = bytes;
		files[file.path] = { path: target, sha256: file.sha256, ...(file.gif || file.png) };
	}
	return { outputs, files, manifestSha256: pin.manifestSha256 };
}

function importArtwork(archive, destination, pin) {
	// Accept only this byte-verified upload, not a general-purpose ZIP extractor.
	const bytes = readRegular(archive, 2 * 1024 * 1024);
	if (hash(bytes) !== pin.archiveSha256) throw Error('Artwork ZIP mismatch');
	const expected = new Set(['manifest.json', ...pin.files.map(f => f.path)]);
	const entries = [];
	let offset = 0;
	while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
		const flags = bytes.readUInt16LE(offset + 6);
		const method = bytes.readUInt16LE(offset + 8);
		const size = bytes.readUInt32LE(offset + 18);
		const unpacked = bytes.readUInt32LE(offset + 22);
		const nameLength = bytes.readUInt16LE(offset + 26);
		const extraLength = bytes.readUInt16LE(offset + 28);
		const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
		const start = offset + 30 + nameLength + extraLength;
		if ((flags & ~0x800) || method || size !== unpacked || start + size > bytes.length || !expected.delete(name)) {
			throw Error('Unsupported/unsafe artwork ZIP entry');
		}
		entries.push([name, bytes.subarray(start, start + size)]);
		offset = start + size;
	}
	if (expected.size) throw Error('Incomplete artwork ZIP');
	const target = path.resolve(destination);
	for (let at = target; at !== path.dirname(at); at = path.dirname(at)) {
		if (fs.lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('Artwork symlink refused');
	}
	if (fs.lstatSync(target, { throwIfNoEntry: false })) throw Error('Artwork destination already exists; preserve it');
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const staging = fs.mkdtempSync(path.join(path.dirname(target), '.tmt2-artwork-'));
	try {
		for (const [name, content] of entries) {
			const file = path.join(staging, name);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, content, { flag: 'wx' });
		}
		loadArtwork(staging, pin);
		// Reserve rather than replacing an existing destination, including an empty directory.
		fs.mkdirSync(target);
		for (const name of fs.readdirSync(staging)) fs.renameSync(path.join(staging, name), path.join(target, name));
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}

module.exports = { loadArtwork, importArtwork };
