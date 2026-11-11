/**
 * Minimal ZIP reader for the browser (and Node).
 * Reads the central directory and inflates entries with the built-in
 * DecompressionStream API, so there is no third-party dependency.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function findEocd(bytes, view) {
  const start = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * List entries matching a predicate.
 * @returns {Map<string, {method: number, compressed: Uint8Array, size: number}>}
 */
export function listZipEntries(buffer, predicate = () => true) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);

  if (eocd < 0) throw new Error('This does not look like a valid ZIP file (no end record found).');

  const entryCount = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported. Please use the original tmw-freq.zip.');
  }

  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let offset = directoryOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error('The ZIP central directory is corrupted or unsupported.');
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    offset += 46 + nameLength + extraLength + commentLength;

    if (!predicate(name)) continue;

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(`Could not find the local header for "${name}".`);
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > bytes.length) throw new Error(`"${name}" extends past the end of the archive.`);

    entries.set(name, {
      method,
      size,
      compressed: bytes.subarray(dataStart, dataEnd),
    });
  }

  return entries;
}

export async function inflateRaw(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error(
      'Your browser does not support DecompressionStream. Use a current version of Chrome, Edge, Firefox or Safari.',
    );
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntryText(entry) {
  let raw;
  if (entry.method === 0) {
    raw = entry.compressed;
  } else if (entry.method === 8) {
    raw = await inflateRaw(entry.compressed);
  } else {
    throw new Error(`Unsupported ZIP compression method ${entry.method}.`);
  }

  return new TextDecoder('utf-8').decode(raw);
}

/**
 * Read all matching entries as UTF-8 text.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {(name: string) => boolean} predicate
 * @param {(done: number, total: number, name: string) => void} [onEntry]
 */
export async function readZipTexts(buffer, predicate, onEntry) {
  const entries = listZipEntries(buffer, predicate);
  const texts = new Map();
  const total = entries.size;
  let done = 0;

  for (const [name, entry] of entries) {
    texts.set(name, await readZipEntryText(entry));
    done += 1;
    onEntry?.(done, total, name);
  }

  return texts;
}
