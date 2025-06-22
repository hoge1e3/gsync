// @acepad/git
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { promisify } from 'util';

type ObjectType="commit" | "tree" | "blob" | "tag";
function isObjectType(type: string): type is ObjectType {
  return ['commit', 'tree', 'blob', 'tag'].includes(type);
}
const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate);
// src/repo.ts の先頭付近
export type TreeEntry = {
  mode: string;         // e.g. "100644" or "40000"
  name: string;         // ファイル名 or ディレクトリ名
  hash: string;         // SHA-1 ハッシュ（hex文字列）
};
export type CommitEntry = {
  tree: string;
  parents: string[];            // ← 配列に変更（複数 parent 対応）
  author: string;
  committer: string;
  message: string;
};
export type GitObject={ type: ObjectType; hash: string, content: Buffer };
export class Repo {
  constructor(public gitDir: string) {}

  private getObjectPath(hash: string): string {
    const dir = path.join(this.gitDir, 'objects', hash.slice(0, 2));
    const file = path.join(dir, hash.slice(2));
    return file;
  }

  async readObject(hash: string): Promise<GitObject> {
    const filePath = this.getObjectPath(hash);
    const compressed = await fs.promises.readFile(filePath);
    const data = await inflate(compressed);

    const nullIndex = data.indexOf(0);
    const header = data.slice(0, nullIndex).toString();
    const [type, sizeStr] = header.split(' ');
    const size = parseInt(sizeStr, 10);
    const content = data.slice(nullIndex + 1);

    if (content.length !== size) {
      throw new Error(`Size mismatch: expected ${size}, got ${content.length}`);
    }
    if (!isObjectType(type)) {
      throw new Error(`Unknown object type: ${type}`);
    }
    return { type, content , hash};
  }

  async writeObject(type: ObjectType, content: Buffer): Promise<string> {
    const header = `${type} ${content.length}\0`;
    const store = Buffer.concat([Buffer.from(header), content]);
    const hash = crypto.createHash('sha1').update(store).digest('hex');

    const filePath = this.getObjectPath(hash);
    const dirPath = path.dirname(filePath);
    await fs.promises.mkdir(dirPath, { recursive: true });

    const compressed = await deflate(store);
    await fs.promises.writeFile(filePath, compressed);

    return hash;
  }

  hashObject(type: string, content: Buffer): string {
    const header = `${type} ${content.length}\0`;
    const store = Buffer.concat([Buffer.from(header), content]);
    return crypto.createHash('sha1').update(store).digest('hex');
  }

  async readBlobAsText(hash: string): Promise<string> {
    const { type, content } = await this.readObject(hash);
    if (type !== 'blob') {
      throw new Error(`Expected blob, got ${type}`);
    }
    return content.toString('utf-8');
  }
  async readTree(hash: string): Promise<TreeEntry[]> {
    const { type, content } = await this.readObject(hash);
    if (type !== 'tree') {
      throw new Error(`Expected tree, got ${type}`);
    }

    const entries: TreeEntry[] = [];
    let offset = 0;

    while (offset < content.length) {
      // mode（ASCIIでspace区切り）
      const spaceIdx = content.indexOf(0x20, offset);
      const mode = content.slice(offset, spaceIdx).toString();

      // name（null文字まで）
      const nullIdx = content.indexOf(0x00, spaceIdx);
      const name = content.slice(spaceIdx + 1, nullIdx).toString();

      // SHA-1（20バイトのバイナリ）
      const hashBuffer = content.slice(nullIdx + 1, nullIdx + 21);
      const hash = hashBuffer.toString('hex');

      entries.push({ mode, name, hash });
      offset = nullIdx + 21; // 次のエントリへ
    }

    return entries;
  }
  encodeTree(entries: TreeEntry[]): Buffer {
    const buffers: Buffer[] = [];

    for (const entry of entries) {
      const modeName = `${entry.mode} ${entry.name}`;
      const modeNameBuf = Buffer.from(modeName, 'utf8');
      const nullByte = Buffer.from([0]);

      if (entry.hash.length !== 40) {
        throw new Error(`Invalid hash length: ${entry.hash}`);
      }

      const hashBuf = Buffer.from(entry.hash, 'hex'); // 20 bytes

      buffers.push(Buffer.concat([modeNameBuf, nullByte, hashBuf]));
    }

    return Buffer.concat(buffers);
  }
  async writeTree(entries: TreeEntry[]): Promise<string> {
    const content = this.encodeTree(entries);
    return await this.writeObject('tree', content);
  }
  async readCommit(hash: string): Promise<CommitEntry> {
    const { type, content } = await this.readObject(hash);
    if (type !== 'commit') {
      throw new Error(`Expected commit, got ${type}`);
    }
  
    const text = content.toString('utf-8');
    const lines = text.split('\n');
  
    const entry: CommitEntry = {
      tree: '',
      parents: [],
      author: '',
      committer: '',
      message: ''
    };
  
    let inMessage = false;
    const messageLines: string[] = [];
  
    for (const line of lines) {
      if (!inMessage && line === '') {
        inMessage = true;
        continue;
      }
  
      if (inMessage) {
        messageLines.push(line);
      } else if (line.startsWith('tree ')) {
        entry.tree = line.slice(5);
      } else if (line.startsWith('parent ')) {
        entry.parents.push(line.slice(7));
      } else if (line.startsWith('author ')) {
        entry.author = line.slice(7);
      } else if (line.startsWith('committer ')) {
        entry.committer = line.slice(10);
      }
    }
  
    entry.message = messageLines.join('\n');
    return entry;
  }
  encodeCommit(entry: CommitEntry): Buffer {
    const lines: string[] = [];
    lines.push(`tree ${entry.tree}`);
    for (const parent of entry.parents) {
      lines.push(`parent ${parent}`);
    }
    lines.push(`author ${entry.author}`);
    lines.push(`committer ${entry.committer}`);
    lines.push('');
    lines.push(entry.message);
  
    return Buffer.from(lines.join('\n'), 'utf-8');
  }
  async writeCommit(entry: CommitEntry) {
    return await this.writeObject("commit", this.encodeCommit(entry));
  }
  async readHead(branch: string): Promise<string> {
    const refPath = path.join(this.gitDir, "refs/heads", branch);
    const data = await fs.promises.readFile(refPath, 'utf-8');
    const hash = data.trim();

    if (!/^[0-9a-f]{40}$/.test(hash)) {
      throw new Error(`Invalid ref content in ${branch}: ${hash}`);
    }
    return hash;
  }
  async *traverseTree(
    entries: TreeEntry[],
    prefix = ''
  ): AsyncGenerator<{ path: string; hash: string; content?: Buffer }> {
    for (const entry of entries) {
      const fullPath = path.posix.join(prefix, entry.name);
      const { type, content } = await this.readObject(entry.hash);

      if (type === 'blob') {
        yield { path: fullPath, hash: entry.hash, content };
      } else if (type === 'tree') {
        yield { path: fullPath, hash: entry.hash };
        const childEntries = await this.readTree(entry.hash);
        yield* this.traverseTree(childEntries, fullPath); // 再帰呼び出し
      } else {
        // 他の型（e.g. commit）はスキップまたはエラー
        throw new Error(`Unexpected object type in tree: ${type}`);
      }
    }
  }
  async mergeBranches(into: string, from: string, author: string): Promise<string> {
    const baseCommitHash = await this.readHead(into);
    const mergeCommitHash = await this.readHead(from);

    const baseCommit = await this.readCommit(baseCommitHash);
    const mergeCommit = await this.readCommit(mergeCommitHash);

    const baseTree = await this.readTree(baseCommit.tree);
    const mergeTree = await this.readTree(mergeCommit.tree);

    // ★ 単純なファイル名ベースのユニオン（重複は base を優先）
    const mergedMap = new Map<string, TreeEntry>();
    for (const e of mergeTree) mergedMap.set(e.name, e);
    for (const e of baseTree) mergedMap.set(e.name, e); // base 優先

    const mergedEntries = Array.from(mergedMap.values());
    const mergedTreeHash = await this.writeTree(mergedEntries);

    const now = Math.floor(Date.now() / 1000);
    const info = `${author} ${now} +0000`;

    const mergedCommit:CommitEntry = {
      tree: mergedTreeHash,
      parents: [baseCommitHash, mergeCommitHash],
      author: info,
      committer: info,
      message: `Merge branch '${from}' into '${into}'`
    };

    const newCommitHash = await this.writeCommit(mergedCommit);

    // refs/heads/baseBranch を更新
    await this.updateRef(path.join('refs', 'heads', into), newCommitHash);

    return newCommitHash;
  }
  async updateRef(refPath: string, hash: string): Promise<void> {
    const fullPath = path.join(this.gitDir, refPath);
    const dirPath = path.dirname(fullPath);
    await fs.promises.mkdir(dirPath, { recursive: true });
    await fs.promises.writeFile(fullPath, hash);
  }
  async findMergeBase(commitHashA: string, commitHashB: string): Promise<string | null> {
    // visitedA と visitedB に各ブランチの履歴を記録
    const visitedA = new Set<string>();
    const visitedB = new Set<string>();

    // 両方の探索キュー
    const queueA = [commitHashA];
    const queueB = [commitHashB];

    // 両方向から探索（BFS）
    while (queueA.length > 0 || queueB.length > 0) {
      // ブランチAから
      if (queueA.length > 0) {
        const hash = queueA.shift()!;
        if (visitedB.has(hash)) return hash;
        if (visitedA.has(hash)) continue;

        visitedA.add(hash);
        const commit = await this.readCommit(hash);
        queueA.push(...commit.parents);
      }

      // ブランチBから
      if (queueB.length > 0) {
        const hash = queueB.shift()!;
        if (visitedA.has(hash)) return hash;
        if (visitedB.has(hash)) continue;

        visitedB.add(hash);
        const commit = await this.readCommit(hash);
        queueB.push(...commit.parents);
      }
    }

    // 共通祖先がない（ありえないが保険）
    return null;
  }

}