import { ObjectEntry, ObjectStore } from './objects.js';
import { asHash, BranchName, GitObject, Hash } from './types.js';
import { dateToPhpTimestamp, phpTimestampToDate, toBase64 } from './util.js';

/**
 * Interface exposing dedicated methods with separate parameters (no args object).
 */
export interface WebServerApi {
  repoId: string;
  objectStore: ObjectStore;
  createRepository(): Promise<{ repo_id: string }>;
  setHead(branch: BranchName, current:Hash, next: Hash): Promise<void>;
  addHead(branch: BranchName, next: Hash): Promise<void>;
  hasHead(branch: BranchName): Promise<boolean>;
  getHead(branch: BranchName): Promise<Hash>;
  uploadObjects(objects: ObjectEntry[]): Promise<Date>;
  downloadObjects(since?: Date): Promise<Date>;
}
type Actions="create"|"upload"|"download"|"get_head"|"set_head";
type StringifiedObject={ hash: Hash; content: string };
export class PHPClient implements WebServerApi {
  constructor(
    public serverUrl: string,
    public repoId: string,
    public apiKey: string,
    public objectStore: ObjectStore,
  ) {}

  private async post(action: Actions, data: any) {
    const response = await fetch(`${this.serverUrl}?action=${action}`, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (response.status !== 200) {
      throw new Error(await response.text());
    }
    return await response.json();
  }

  async createRepository(): Promise<{ repo_id: string }> {
    const res = await this.post("create", { api_key: this.apiKey });
    this.repoId = res.repo_id;
    return res;
  }

  async addHead(branch: BranchName, next: Hash): Promise<void> {
    const data=await this.post("set_head", {
      repo_id: this.repoId,
      branch,
      next,
      api_key: this.apiKey,
    });
    if (data.status==="ok") {
        return ;
    }
        throw new Error(branch+" already exists. status="+data.status);
  }
  async setHead(branch: BranchName, current:Hash, next: Hash): Promise<void> {
    const data=await this.post("set_head", {
      repo_id: this.repoId,
      branch,
      current, next,
      api_key: this.apiKey,
    });
    if (data.status==="ok") {
        return ;
    }
    throw new Error("Atomic change failed: Someone changed the head to "+data.status);
  }


  async hasHead(branch: BranchName): Promise<boolean> {
    const res = await this.post("get_head", {
      repo_id: this.repoId,
      branch,
      allow_nonexistent: 1,
      api_key: this.apiKey,
    });
    return !!res.hash;
  }
  async getHead(branch: BranchName): Promise<Hash> {
    const res = await this.post("get_head", {
      repo_id: this.repoId,
      branch,
      allow_nonexistent: 0,
      api_key: this.apiKey,
    });
    return asHash(res.hash);
  }

  async uploadObjects(objects: ObjectEntry[]): Promise<Date> {
    const sObjects: StringifiedObject[] = 
        objects.map((entry)=>({
            hash: entry.hash,
            content: toBase64(entry.content)
        }));
    const data=await this.post("upload", {
      repo_id: this.repoId,
      api_key: this.apiKey,
      objects: sObjects,
    });
    return phpTimestampToDate(data.timestamp);
  }

  async downloadObjects(since:Date): Promise<Date> {
    const res = await this.post("download", {
      repo_id: this.repoId,
      api_key: this.apiKey,
      since: dateToPhpTimestamp(since),
    });
    const sObjects=res.objects as StringifiedObject[];
    const newDownloadSince = phpTimestampToDate(res.newest);
    const objectStore=this.objectStore;
    let downloaded=0, skipped=0;
    for (const { hash, content } of sObjects) {
        asHash(hash);
        downloaded++;
        if (await objectStore.has(hash)) {
            skipped++;
        } else {
            const binary = Buffer.from(content, 'base64');
            await objectStore.put(hash,  binary);
        }
    }
    console.log(downloaded," objects downloaded. ",skipped," objects skipped.");
    return newDownloadSince;
  }
}
