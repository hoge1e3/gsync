
const SymHash=Symbol("hash");
export type Hash=string&{[SymHash]:undefined};
export function isHash(s: string): s is Hash {
  return /^[0-9a-f]{40}$/.test(s);  
}
export function asHash(s:string) {
  if (!isHash(s)) throw new Error(`${s} is not a hash`);
  return s;
}
//const SymMode=Symbol("mode");
export type Mode="40000"|"100644";
export function isMode(s: string): s is Mode {
  return /^[0-9]+$/.test(s);  
}
export function asMode(s: string) {
  if (!isMode(s)) throw new Error(`${s} is not a mode`);
  return s;
}

const SymRelPath=Symbol("path");
export type RelPath=string&{[SymRelPath]:undefined};
export function isRelPath(s:string): s is RelPath{
  return true;
}
const SymAbsPath=Symbol("path");
export type AbsPath=string&{[SymAbsPath]:undefined};
export function isAbsPath(s:string): s is AbsPath{
  return true;
}
export type Path=RelPath|AbsPath;
export function isPath(s:string): s is Path {
  return isAbsPath(s) || isRelPath(s);
}
export function asPath(s:string) {
  if (!isPath(s)) throw new Error(`${s} is not a path`);
  return s;
}
export function asRelPath(s:string) {
  if (!isRelPath(s)) throw new Error(`${s} is not a relative path`);
  return s;
}
const SymFilename=Symbol("filename");
export type Filename=string&{[SymFilename]:undefined};
export function isFilename(s:string): s is Filename{
  return true;
}
export function asFilename(s:string) {
  if (!isFilename(s)) throw new Error(`${s} is not a filename`);
  return s;
}
/*const SymBranch=Symbol("branch");
export function isBranchName(s:string): s is BranchName{
  return true;
}
export function asBranchName(s:string) {
  if (!isBranchName(s)) throw new Error(`${s} is not a branch name`);
  return s;
}
export type BranchName=string&{[SymBranch]:undefined};
*/
const SymRef=Symbol("ref");
export function isRef(s:string): s is Ref{
  return !!s.match(/^refs\//);
}
export function asRef(s:string) {
  if (!isRef(s)) throw new Error(`${s} is not a ref path`);
  return s;
}
export function fromBranchName(s:string):Ref {
  return asRef(`refs/heads/${s}`);
}
export type Ref=string&{[SymRef]:undefined};

export type Conflict = { path: Path; base?: Hash; a?: Hash; b?: Hash };
export type ObjectType = "commit" | "tree" | "blob" | "tag";
export function isObjectType(type: string): type is ObjectType {
  return ['commit', 'tree', 'blob', 'tag'].includes(type);
}
export type TreeDiffEntry = {
  path: Path;
  type: 'added' | 'deleted' | 'modified';
  oldHash?: Hash;
  newHash?: Hash;
};

// src/repo.ts の先頭付近
export type TreeEntry = {
  mode: Mode;         // e.g. "100644" or "40000"
  name: Filename;         // ファイル名 or ディレクトリ名
  hash: Hash;         // SHA-1 ハッシュ（hex文字列）
};
export type CommitEntry = {
  tree: Hash;
  parents: Hash[];            // ← 配列に変更（複数 parent 対応）
  author: Author;
  committer: Author;
  message: string;
};
export class Author {
  name: string;
  email: string;
  date: Date;
  constructor(
    name: string,
    email: string,
    date: Date = new Date()
  ) {
    this.name = name;
    this.email = email;
    this.date = date;
  }

  toString(): string {
    const timestamp = Math.floor(this.date.getTime() / 1000);
    const offsetMinutes = this.date.getTimezoneOffset();
    const absMinutes = Math.abs(offsetMinutes);
    const sign = offsetMinutes > 0 ? '-' : '+';
    const hh = String(Math.floor(absMinutes / 60)).padStart(2, '0');
    const mm = String(absMinutes % 60).padStart(2, '0');
    const tz = `${sign}${hh}${mm}`;

    return `${this.name} <${this.email}> ${timestamp} ${tz}`;
  }
  static parse(str: string): Author {
    const match = str.match(/^(.+?) <(.+?)> (\d+) ([+-]\d{4})$/);
    if (!match) {
      throw new Error(`Invalid author format: ${str}`);
    }
    const [, name, email, timestampStr, tz] = match;
    const timestamp = parseInt(timestampStr, 10);
    // タイムゾーンの補正は入れない（Gitはそのまま保存してる）
    const date = new Date(timestamp * 1000);
    return new Author(name, email, date);
  }
}
export type GitObject = { type: ObjectType; hash: Hash, content: Buffer };
