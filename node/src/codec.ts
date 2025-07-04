// compress.js
let loaded:{
    createDeflate: typeof import('node:zlib').createDeflate;
    createInflate: typeof import('node:zlib').createInflate;
    createHash: typeof import("node:crypto").createHash;
    Readable: typeof import('node:stream').Readable;
    Buffer: BufferConstructor;
};
async function loadNodeLibs(){
    if (loaded) return loaded;
    const { createHash } = await import('node:crypto');
    const { createDeflate,createInflate } = await import('node:zlib');
    const { Readable } = await import('node:stream');
    const { Buffer } = await import('node:buffer');
    loaded={createDeflate, createInflate, Readable, Buffer, createHash}; 
    return loaded;
}
export async function deflate(uint8array:Uint8Array<ArrayBuffer>):Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    // --- ブラウザ環境 ---
    const stream = new Blob([uint8array])
      .stream()
      .pipeThrough(new CompressionStream('deflate'));

    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } else {
    // --- Node.js 環境 ---
    const { createDeflate , Readable , Buffer} = await loadNodeLibs();
    const input = Buffer.from(uint8array);
    const chunks = [] as number[];

    await new Promise((resolve, reject) => {
      Readable.from([input])
        .pipe(createDeflate())
        .on('data', chunk => chunks.push(chunk))
        .on('end', resolve)
        .on('error', reject);
    });

    return Uint8Array.from(chunks);
  }
}

export async function inflate(uint8array:Uint8Array<ArrayBuffer>):Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    // --- ブラウザ環境 ---
    const stream = new Blob([uint8array])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } else {
    // --- Node.js 環境 ---
    const {createInflate,  Readable , Buffer} = await loadNodeLibs();

    const input = Buffer.from(uint8array);
    const chunks = [] as number[];

    await new Promise((resolve, reject) => {
      Readable.from([input])
        .pipe(createInflate())
        .on('data', chunk => chunks.push(chunk))
        .on('end', resolve)
        .on('error', reject);
    });

    return Uint8Array.from(chunks);
  }
}

export async function sha1Hex(input:Uint8Array<ArrayBuffer>):Promise<string> {
  const buffer = input;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer.buffer);
    return [...new Uint8Array(hashBuffer)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    const { createHash } = await loadNodeLibs();
    const hash = createHash('sha1').update(buffer).digest('hex');
    return hash;
  }
}
