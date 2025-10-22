// @acepad/git
import * as fs from 'fs';
import * as path from 'path';
import * as path_typed from "./path_typed.js";
/*import zlib from 'zlib';
import crypto from 'crypto';*/
import ignore from 'ignore';
//import { promisify } from 'util';
import { asFilename, asHash, asMode, Author, Ref, CommitEntry, Conflict, GitObject, Hash, isObjectType, ObjectType, TreeDiffEntry, TreeEntry, BranchName, asBranchName, asLocalRef, PathInRepo, FilePath, asFilePath, asPathInRepo } from './types.js';
import { inflate, deflate ,sha1Hex } from './codec.js';
import { factory, ObjectStore } from './objects.js';
/*const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate);*/
export class Repo {
  _objectStore:ObjectStore|undefined;
  constructor(public gitDir: FilePath) {
  }
  async getObjectStore(): Promise<ObjectStore> {
    if (this._objectStore) return this._objectStore;
    this._objectStore=await factory(this.gitDir);
    /*const objdir = asFilePath(path.join(this.gitDir, 'objects'));
    this._objectStore=new FileBasedObjectStore(objdir);   */
    return this._objectStore;
  }
  toFilePath(pathInRepo: PathInRepo) {
    const r=path.join(this.workingDir(), pathInRepo );
    return asFilePath(r);
  }
  toPathInRepo(filePath: FilePath):PathInRepo {
    const r=path.relative(this.workingDir(), filePath);
    if (r.startsWith("..")) throw new Error(`${filePath} is out of working dir ${this.workingDir()}`);
    return asPathInRepo(r);
  }
  async readObject(hash: Hash): Promise<GitObject> {
    /*const filePath = this.getObjectPath(hash);
    const compressed = await fs.promises.readFile(filePath);*/
    const objectStore=await this.getObjectStore();
    const {mtime, content:compressed} = await objectStore.get(hash);

    const data = Buffer.from(await inflate(new Uint8Array(compressed)));

    const nullIndex = data.indexOf(0);
    const header = data.subarray(0, nullIndex).toString();
    const [type, sizeStr] = header.split(' ');
    const size = parseInt(sizeStr, 10);
    const content = data.subarray(nullIndex + 1);

    if (content.length !== size) {
      throw new Error(`Size mismatch: expected ${size}, got ${content.length}`);
    }
    if (!isObjectType(type)) {
      throw new Error(`Unknown object type: ${type}`);
    }
    return { type, content, hash };
  }

  async writeObject(type: ObjectType, content: Uint8Array): Promise<Hash> {
    const header = `${type} ${content.length}\0`;
    const store = new Uint8Array(Buffer.concat([Buffer.from(header), content]));
    const hash = asHash( await sha1Hex(store));// crypto.createHash('sha1').update(store).digest('hex') );
    const objectStore=await this.getObjectStore();
    if (await objectStore.has(hash)) {
      return hash;
    }
    const compressed = await deflate(store);
    objectStore.put(hash, compressed);

    /*const filePath = this.getObjectPath(hash);
    if (fs.existsSync(filePath)) {
      return hash; // 既に存在する場合はそのまま返す
    }
    const dirPath = path.dirname(filePath);
    await fs.promises.mkdir(dirPath, { recursive: true });

    const compressed = await deflate(store);
    await fs.promises.writeFile(filePath, compressed);
    */
    return hash;
  }

  /*async hashObject(type: ObjectType, content: Buffer): Promise<Hash> {
    const header = `${type} ${content.length}\0`;
    const store = Buffer.concat([Buffer.from(header), content]);
    return asHash( await sha1Hex(store) );// crypto.createHash('sha1').update(store).digest('hex')
  }*/

  async readBlobAsText(hash: Hash): Promise<string> {
    const { type, content } = await this.readObject(hash);
    if (type !== 'blob') {
      throw new Error(`Expected blob, got ${type}`);
    }
    return content.toString('utf-8');
  }
  async readTree(hash: Hash): Promise<TreeEntry[]> {
    const { type, content } = await this.readObject(hash);
    if (type !== 'tree') {
      throw new Error(`Expected tree, got ${type}`);
    }

    const entries: TreeEntry[] = [];
    let offset = 0;

    while (offset < content.length) {
      // mode（ASCIIでspace区切り）
      const spaceIdx = content.indexOf(0x20, offset);
      const mode = asMode( content.subarray(offset, spaceIdx).toString());

      // name（null文字まで）
      const nullIdx = content.indexOf(0x00, spaceIdx);
      const name = asFilename( content.subarray(spaceIdx + 1, nullIdx).toString() );

      // SHA-1（20バイトのバイナリ）
      const hashBuffer = content.subarray(nullIdx + 1, nullIdx + 21);
      const hash = asHash( hashBuffer.toString('hex'));

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
  async writeTree(entries: TreeEntry[]): Promise<Hash> {
    const content = this.encodeTree(entries);
    return await this.writeObject('tree', content);
  }

  async buildTreeFromWorkingDir(): Promise<TreeEntry[]> {
    const workingDir = this.workingDir();
    let ig = new RecursiveGitIgnore();
    const dot_gsync=path.basename(this.gitDir);
    const baseig=ignore();
    baseig.add(".git");
    baseig.add(dot_gsync);
    const walk = async (dir: FilePath): Promise<TreeEntry[]> => {
      ig=ig.pushed(dir);
      try {
        const entries: TreeEntry[] = [];
        const files = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const file of files) {
          const name = asFilename(file.name);
          const fullPath = asFilePath(path.join(dir, name));
          const relPath = path.relative(workingDir, fullPath);

          // 除外対象（.gitignore + .git フォルダ）をスキップ
          if (
            ig.ignores(fullPath) || baseig.ignores(relPath)
          ) {
            //console.log("Ignored ",fullPath);
            continue;
          }

          //const fullPath = asPath( path.join(dir, name) );
          //const stat = await fs.promises.stat(fullPath);

          if (file.isFile()) {
            const _content = await fs.promises.readFile(fullPath);
            const content = stripCR(_content);
            const hash = await this.writeObject('blob', content);
            //console.log("File" , fullPath, hash);

            entries.push({ mode: '100644', name, hash });
          } else if (file.isDirectory() && !this.isSubRepo(fullPath)) {
            const childEntries = await walk(fullPath);
            const treeHash = await this.writeTree(childEntries);
            //console.log("Dir" , fullPath, treeHash);
            entries.push({ mode: '40000', name, hash: treeHash });
          }
        }
        return entries;
      } finally{
        ig=ig.poped();
      }
    };

    return await walk(workingDir);
  }

  workingDir() {
    return asFilePath(path.resolve(this.gitDir, '..'));
  }
  inWorkingDir(_path: FilePath) {
    return path.normalize(_path).startsWith(path.normalize(this.workingDir()));
  }
  async readCommit(hash: Hash): Promise<CommitEntry> {
    const { type, content } = await this.readObject(hash);
    if (type !== 'commit') {
      throw new Error(`Expected commit, got ${type}`);
    }

    const text = content.toString('utf-8');
    const lines = text.split('\n');

    /*const entry: CommitEntry = {
      tree: '',
      parents: [],
      author: '',
      committer: '',
      message: ''
    };*/
    let tree:Hash|undefined=undefined;
    let parents:Hash[]=[];
    let author:Author|undefined=undefined;
    let committer:Author|undefined=undefined;
    let message="";

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
        tree = asHash(line.slice(5));
      } else if (line.startsWith('parent ')) {
        parents.push(asHash(line.slice(7)));
      } else if (line.startsWith('author ')) {
        author = Author.parse(line.slice(7));
      } else if (line.startsWith('committer ')) {
        committer = Author.parse(line.slice(10));
      }
    }
    message = messageLines.join('\n');
    if (!tree) throw new Error("Missing tree");
    if (!author) throw new Error("Missing author");
    if (!committer) throw new Error("Missing commiter");
    return {
      tree, parents, author, committer, message
    };
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
  async readHead(ref: Ref): Promise<Hash|null> {
    const refPath = path.join(this.gitDir, ref);
    if (!fs.existsSync(refPath)) return null;
    const data = await fs.promises.readFile(refPath, 'utf-8');
    const hash = asHash(data.trim());
    return hash;
  }
  async *traverseTree(
    entries: TreeEntry[],
    prefix = '' as PathInRepo
  ): AsyncGenerator<{ path: PathInRepo; hash: Hash; content?: Buffer }> {
    for (const entry of entries) {
      const relPath = asPathInRepo(path.posix.join(prefix, entry.name));
      const { type, content } = await this.readObject(entry.hash);

      if (type === 'blob') {
        yield { path: relPath, hash: entry.hash, content };
      } else if (type === 'tree') {
        yield { path: relPath, hash: entry.hash };
        const childEntries = await this.readTree(entry.hash);
        yield* this.traverseTree(childEntries, relPath); // 再帰呼び出し
      } else {
        // 他の型（e.g. commit）はスキップまたはエラー
        throw new Error(`Unexpected object type in tree: ${type}`);
      }
    }
  }
  async updateHead(ref: Ref, hash: Hash): Promise<void> {
    const fullPath = path.join(this.gitDir, ref);
    const dirPath = path.dirname(fullPath);
    await fs.promises.mkdir(dirPath, { recursive: true });
    await fs.promises.writeFile(fullPath, hash);
  }
  async findMergeBase(commitHashA: Hash, commitHashB: Hash): Promise<Hash> {
    // visitedA と visitedB に各ブランチの履歴を記録
    const visitedA = new Set<Hash>();
    const visitedB = new Set<Hash>();

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
    throw new Error(`Unrelated history: ${commitHashA} and ${commitHashB}`);
  }
  async diffTreeRecursive(
    oldTree: TreeEntry[],
    newTree: TreeEntry[],
    prefix = '' as PathInRepo
  ): Promise<TreeDiffEntry[]> {
    const diffs: TreeDiffEntry[] = [];

    const oldMap = new Map(oldTree.map(e => [e.name, e]));
    const newMap = new Map(newTree.map(e => [e.name, e]));

    const names = new Set([...oldMap.keys(), ...newMap.keys()]);
    const igc=new IgnoreChecker(this);

    for (const name of names) {
      const oldEnt = oldMap.get(name);
      const newEnt = newMap.get(name);
      const relPath = asPathInRepo(path.posix.join(prefix, name));
      const fullPath = path_typed.join(this.workingDir(), relPath);
      if (igc.ignores(fullPath)) continue;

      if (oldEnt && !newEnt) {
        // 削除
        if (oldEnt.mode === '40000') {
          const baseSub = await this.readTree(oldEnt.hash);
          const subDiffs = await this.diffTreeRecursive(baseSub, [], relPath);
          diffs.push(...subDiffs);
        } else {
          diffs.push({ path: relPath, type: 'deleted', oldHash: oldEnt.hash });
        }
      } else if (!oldEnt && newEnt) {
        // 追加
        if (newEnt.mode === '40000') {
          const otherSub = await this.readTree(newEnt.hash);
          const subDiffs = await this.diffTreeRecursive([], otherSub, relPath);
          diffs.push(...subDiffs);
        } else {
          diffs.push({ path: relPath, type: 'added', newHash: newEnt.hash });
        }
      } else if (oldEnt && newEnt) {
        if (oldEnt.mode === '40000' && newEnt.mode === '40000') {
          // ディレクトリどうし → 再帰
          const baseSub = await this.readTree(oldEnt.hash);
          const otherSub = await this.readTree(newEnt.hash);
          const subDiffs = await this.diffTreeRecursive(baseSub, otherSub, relPath);
          diffs.push(...subDiffs);
        } else if (oldEnt.hash !== newEnt.hash) {
          // ファイルが変更
          diffs.push({
            path: relPath,
            type: 'modified',
            oldHash: oldEnt.hash,
            newHash: newEnt.hash
          });
        }
        // else: hash が同じ → 無視
      }
    }

    return diffs;
  }
  async threeWayMerge(
    baseTree: TreeEntry[],
    aTree: TreeEntry[],
    bTree: TreeEntry[],
  ): Promise<{
    toA: TreeDiffEntry[];
    toB: TreeDiffEntry[];
    conflicts: Conflict[];
  }> {
    const [diffA, diffB] = await Promise.all([
      this.diffTreeRecursive(baseTree, aTree),
      this.diffTreeRecursive(baseTree, bTree)
    ]);
    const toA: TreeDiffEntry[] = [];
    const toB: TreeDiffEntry[] = [];
    const conflicts: Conflict[] = [];
    const allPaths= new Set([...diffA, ...diffB].map(d=>d.path));
    const diffMapA= new Map(diffA.map(d=>[d.path,d]));
    const diffMapB= new Map(diffB.map(d=>[d.path,d]));
    for (const path of allPaths) {
      const da=diffMapA.get(path);
      const db=diffMapB.get(path);
      if (da && db) {
        if (da.type==="deleted" && db.type==="deleted") {
        } else if (da.type==="deleted") {
          toA.push(db);
        } else if (db.type==="deleted") {
          toB.push(da);
        } else if (da.type==="modified" && db.type==="modified") {
          if (da.oldHash!==db.oldHash) {
            throw new Error(`old hash does not match ${da.oldHash} !== ${db.oldHash}`);
          }
          conflicts.push({path, base:da.oldHash, a:da.newHash, b:db.newHash});
        } else if (da.type==="added" && db.type==="added") {
          conflicts.push({path, a:da.newHash, b:db.newHash});
        } else {
          // add & modified never happens
          throw new Error(`Invalid state: a: ${da.type}, b: ${db.type}`);
        }
      } else if (db) {
        toA.push(db);
      } else if (da) {
        toB.push(da);
      }
    }
    return {
      toA, toB, conflicts
    };
  }
  async checkoutTreeToDir(treeHash: Hash, dirPath: FilePath): Promise<void> {
    const entries = await this.readTree(treeHash);

    for (const entry of entries) {
      const outPath = asFilePath(path.join(dirPath, entry.name));

      if (entry.mode === '40000') {
        // ディレクトリ（tree）→ 再帰的に処理
        await fs.promises.mkdir(outPath, { recursive: true });
        await this.checkoutTreeToDir(entry.hash, outPath);
      } else {
        // blob → ファイルとして書き出す
        const { type, content } = await this.readObject(entry.hash);
        if (type !== 'blob') {
          throw new Error(`Unexpected object type ${type} for ${entry.name}`);
        }
        await fs.promises.writeFile(outPath, content);
      }
    }
  }
  async getCurrentBranchName(): Promise<BranchName> {
    const headPath = this.headPath();
    const content = await fs.promises.readFile(headPath, 'utf8');

    const match = content.match(/^ref: refs\/heads\/(.+)\s*$/);
    if (match) {
      return asBranchName(match[1]); // 例: "main"
    } else {
      // detached HEAD の場合（SHA-1直書き）
      throw new Error("detached HEAD!!");
      //return null;
    }
  }
  headPath() {
    return path.join(this.gitDir, 'HEAD');
  }

  async setCurrentBranchName(branch:BranchName): Promise<void> {
    const headPath = this.headPath();
    const refPath = asLocalRef(branch);
    const content = `ref: ${refPath}\n`;
    await fs.promises.writeFile(headPath, content, 'utf8');

  }
  async readMergeHead():Promise<Hash|null>{
    const MERGE_HEAD=path.join(this.gitDir, "MERGE_HEAD");
    if (!fs.existsSync(MERGE_HEAD)) return null;
    return asHash(await fs.promises.readFile(MERGE_HEAD, {encoding:"utf-8"}));
  }
  async writeMergeHead(commitHash?: Hash) {
    const MERGE_HEAD=path.join(this.gitDir, "MERGE_HEAD");
    if (commitHash) {
      fs.promises.writeFile(MERGE_HEAD, commitHash);
    } else {
      fs.promises.rm(MERGE_HEAD);
    }
  }
  realGitRepoIsSubRepo():boolean{
    return false;// TODO: configure
  }
  isSubRepo(dir:FilePath):boolean {
    if (!this.inWorkingDir(dir)) return false;
    const dot_gsync=path.basename(this.gitDir);
    return (this.realGitRepoIsSubRepo() && fs.existsSync(path.join(dir, ".git"))) || 
          fs.existsSync(path.join(dir, dot_gsync));
  }
  inSubRepo(_path:FilePath):boolean {
    if (!this.inWorkingDir(_path)) return false;
    const workDir=this.workingDir();
    for(;
        path.normalize(workDir)!==path.normalize(_path);
        _path=asFilePath(path.dirname(_path))) {
        if (this.isSubRepo(_path))return true;
      }
      return false;     
  }
  async applyDiff(diffs: TreeDiffEntry[]): Promise<void> {
    const workDir = this.workingDir();
    const igc=new IgnoreChecker(this);
    for (const diff of diffs) {
      const filePath = asFilePath(path.join(workDir, diff.path));
      if (igc.ignores(filePath)) continue;
      if (this.inSubRepo(asFilePath(path.dirname(filePath))))continue;
      if (diff.type === 'deleted') {
        await fs.promises.rm(filePath, { force: true });
      } else if (diff.type === 'added' || diff.type === 'modified') {
        if (!diff.newHash) throw new Error(`Missing 'other' hash for ${diff.path}`);
        const { type, content } = await this.readObject(diff.newHash);
        if (type !== 'blob') throw new Error(`Expected blob, got ${type} for ${diff.path}`);
        writeFileIgnoreingCRLF(filePath, content);
      }
    }
  }
}
export async function writeFileIgnoreingCRLF(filePath: FilePath, content:Buffer) {
  if (fs.existsSync(filePath)) {
    const org=await fs.promises.readFile(filePath); 
    if (sameExceptCRLF(org,content)) return;
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content);
}
export class IgnoreChecker {
  igs=new Map<FilePath, RecursiveGitIgnore>;
  baseig: ignore.Ignore;
  constructor(public repo:Repo) {
    const workingDir = repo.workingDir();
    this.igs.set(workingDir,new RecursiveGitIgnore().pushed(workingDir));
    const dot_gsync=path.basename(repo.gitDir);
    this.baseig=ignore();
    this.baseig.add(".git");
    this.baseig.add(dot_gsync);
  }
  get(dir:FilePath):RecursiveGitIgnore {
    if (!this.repo.inWorkingDir(dir)) throw new Error(`${dir} is out of working dir ${this.repo.workingDir()}`);
    if (this.igs.has(dir)) {
      return this.igs.get(dir)!;
    }
    const parent=path_typed.dirname(dir);
    const r=this.get(parent).pushed(dir);
    this.igs.set(dir,r);
    return r;
  }
  ignores(file:FilePath):boolean{
    const rel=path.relative(this.repo.workingDir(), file);
    if (this.baseig.ignores(rel)) return true;
    const dir=path_typed.dirname(file);
    const ig=this.get(dir); 
    return ig.ignores(file);
  }
}

type IgnoreStack={
    dir:FilePath,
    ig:ignore.Ignore;
};
export class RecursiveGitIgnore{
  constructor (public stack:ReadonlyArray<IgnoreStack>=[]) {}
  ignores(file:FilePath):boolean{
    for (const {ig, dir} of this.stack) {
      if (file.startsWith(dir)) {
        const rel=path.relative(dir, file);
        //console.log("ignores", dir, rel);
        if(rel!=="" && ig.ignores(rel)) return true;
      }
    }
    return false; // デフォルトは無視しない
  }
  pushed(dir:FilePath):RecursiveGitIgnore{
    const ig=ignore();
    // .gitignore を読み込む（存在する場合）
    const gitignorePath = path.join(dir, '.gitignore');
    try {
      const ignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      ig.add(ignoreContent);
    } catch {
      // .gitignore がない場合は無視
    }
    return new RecursiveGitIgnore([...this.stack, {ig,dir}]);
    //this.stack.push({ig, dir});
  }
  poped():RecursiveGitIgnore{
    return new RecursiveGitIgnore(this.stack.slice(0,this.stack.length-1));
    //this.stack.pop();
  }
}


export function stripCR(content: Buffer<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  function isUtf8Text(buffer:Buffer<ArrayBufferLike>):string|null {
    try {
      const text = new TextDecoder().decode(buffer);
      // そもそも\r\nがないのだったら置換されないのでnull(そのまま返す)
      if (!text.includes("\r\n")) return null;
      // 制御文字（タブ、改行、キャリッジリターンは許可）
      const controlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
      if (controlChars.test(text)) {
        return null;
      }
      // 文字化けの典型：置換文字（黒いひし形の中に?）が多く含まれていたらNG
      const replacementCharCount = (text.match(/\uFFFD/g) || []).length;
      const replacementRate = replacementCharCount / text.length;
      if (replacementRate > 0.01) {
        return null;
      }
      return text;
    } catch (e) {
      // .toString('utf8')で例外が起きることはまれだが念のため
      return null;
    }
  }
  const t=isUtf8Text(content);
  if (!t) return content;
  return new TextEncoder().encode(t.replace(/\r\n/g,"\n"));
}
export function sameExceptCRLF(a: Buffer, b: Buffer) {
    const sa = stripCR(a);
    const sb = stripCR(b);
    if (sa.byteLength !== sb.byteLength) return false;
    for (let i = 0; i < sa.byteLength; i++) if (sa[i] !== sb[i]) return false;
    return true;
}

