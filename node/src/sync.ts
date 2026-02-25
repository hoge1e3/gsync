import * as fs from 'fs';
import * as path from 'path';
import { BranchName, Hash,FilePath, asFilePath, State, APIConfig} from './types.js';
import { ObjectStore,ObjectEntry, ObjectValue, factory as objectStoreFactory } from './objects.js';
import { REMOTE_CONF_FILE } from './constants.js';
import { dateToPhpTimestamp, phpTimestampToDate } from './util.js';
import { PHPClientFactory, WebApi } from './webapi.js';
import { Repo } from './git.js';

export const GIT_DIR_NAME=".gsync";
const apiFactory=new PHPClientFactory();// TODO: firebase etc.
export class SyncFactory {
    constructor(public gitDir: FilePath){}
    async readConfig(): Promise<APIConfig> {
        const conffile = this.confFile();
        const conf = JSON.parse(await fs.promises.readFile(conffile, { encoding: "utf-8" })) as APIConfig;
        if (!conf.apiKey) {
            conf.apiKey=Math.random().toString(36).slice(2);
            await this.writeConfig(conf);
        }
        return conf;
    }
    async writeConfig(conf:APIConfig): Promise<void> {
        const conffile = this.confFile();
        await fs.promises.writeFile(conffile, JSON.stringify(conf));
    }
    private confFile() {
        return asFilePath(path.join(this.gitDir, REMOTE_CONF_FILE));
    }
    async init(serverUrl: string):Promise<Sync>{
        const gitDir=this.gitDir;
        if (fs.existsSync(gitDir)) {
            throw new Error("Cannot init: "+gitDir+" already exists.");
        }
        const api=await apiFactory.init(serverUrl);
        const offlineStore=await objectStoreFactory(gitDir, api.repoId);
        const downloadableStore=new DownloadableObjectStore(offlineStore,api);
        const sync=new Sync(this,gitDir, downloadableStore, api);

        const conf: APIConfig = api.config;
        await fs.promises.mkdir(gitDir, { recursive: true });
        await this.writeConfig(conf);
        return sync;
    }
    async load():Promise<Sync>{
        const gitDir=this.gitDir;
        if (!fs.existsSync(gitDir)) {
            throw new Error("Cannot load: "+gitDir+" does not exist.");
        }
        const conf=await this.readConfig();
        const api=await apiFactory.load(conf);
        const offlineStore=await objectStoreFactory(gitDir);
        const downloadableStore=new DownloadableObjectStore(offlineStore,api);
        return new Sync(this,gitDir, downloadableStore, api);
    }
}
export class Sync {
    //_objectStore: ObjectStore|undefined;
    //_webapi: WebApi<APIConfig>|undefined;
    repo:Repo;
    constructor(
        public factory: SyncFactory,
        public gitDir: FilePath, 
        public objectStore:ObjectStore,
        public webapi:WebApi<APIConfig>) {
            this.repo=new Repo(gitDir, objectStore);
    }
    async getObjectStore(): Promise<ObjectStore> {
        return this.objectStore;
    }
    async getWebApi():Promise<WebApi<APIConfig>> {
        return this.webapi;
    }
    async readState(): Promise<State> {
        return await (await this.getObjectStore()).getState();
    }
    async writeState(state: State) {
        return await (await this.getObjectStore()).setState(state);
    }
    async uploadObjects(): Promise<void> {
        const state = await this.readState();
        const objects: ObjectEntry[] = [];
        const newUploadSince = dateToPhpTimestamp(new Date());
        const objectStore=await this.getObjectStore();
        for await (const entry of objectStore.iterate(phpTimestampToDate(state.uploadSince))) {
            objects.push( entry);
        }
        if (objects.length === 0) {
            console.log('No new objects to upload.');
            return;
        }
        const api=await this.getWebApi();
        const newest = await api.uploadObjects(objects);
        await this.writeState({ uploadSince: newUploadSince, /*downloadSince: state.downloadSince*/ });
        console.log(`Uploaded ${objects.length} objects. Server timestamp:`, newest/*res.data.timestamp*/);
    }
    readConfig(){
        return this.factory.readConfig();
    }
    /*async downloadObjects(ignoreState:IgnoreState="none"): Promise<void> {
        const state = await this.readState();
        const api=await this.getWebApi();
        const since=  ignoreState==="all" ? new Date(0):
              ignoreState==="max_mtime" ? await maxMtime(await this.getObjectStore()):
              phpTimestampToDate(state.downloadSince);
        const {newest,objects} = await api.downloadSince(since);
        const newDownloadSince = dateToPhpTimestamp(newest);
        const objectStore=await this.getObjectStore();
        let downloaded=0, skipped=0;
        for (const { hash, content } of objects) {
            asHash(hash);
            downloaded++;
            if (await objectStore.has(hash)) {
                skipped++;
            } else {
                await objectStore.put(hash,  content);
            }
        }
        console.log(downloaded," objects downloaded. ",skipped," objects skipped.");
        
        await this.writeState({ uploadSince: state.uploadSince, downloadSince: newDownloadSince });

    }*/
    async hasRemoteHead(branch: BranchName):Promise<boolean> {
        const api=await this.getWebApi();
        const data = await api.hasHead(branch);
        return data;
    }


    async getRemoteHead(branch: BranchName): Promise<Hash> {
        const api=await this.getWebApi();
        const hash = await api.getHead(branch);
        console.log(`HEAD of '${branch}': ${hash ?? '(not set)'}`);
        return hash;
    }
    async setRemoteHead(branch: BranchName, current:Hash, next:Hash): Promise<void> {
        const api=await this.getWebApi();
        await api.setHead(branch, current, next);
    }
    async addRemoteHead(branch: BranchName, next:Hash): Promise<void> {
        const api=await this.getWebApi();
        await api.addHead(branch, next);
    }
}

export class DownloadableObjectStore implements ObjectStore {
    constructor(public offline:ObjectStore, public api:WebApi<APIConfig>){}
    has(hash: Hash): Promise<boolean> {
        // in offline
        return this.offline.has(hash);
    }
    async get(hash: Hash): Promise<ObjectValue> {
        if (await this.offline.has(hash)) return this.offline.get(hash);
        const first=(await this.api.downloadObjects([hash]))[0];
        if (!first) throw new Error(this.api+": "+hash+" is not found.");
        const gito=await Repo.objectEntryToGitObject(first);
        if (gito.type==="tree") {
            const trees=await Repo.gitObjectToTree(gito);
            const hashes=trees.map((e)=>e.hash);
            const toBeDownloaded=[] as Hash[];
            for (let hash of hashes) {
                if (await this.offline.has(hash)) continue;
                toBeDownloaded.push(hash);
            }
            const downloaded=await this.api.downloadObjects(toBeDownloaded);// TODO: use mutablePromise
            for (let e of downloaded) {
                await this.put(e.hash, e.content,true);
            }
        }/* else if (gito.type==="commit") {
            const come=await Repo.gitObjectToCommitEntry(gito);
            await this.get(come.tree);// TODO: use mutablePromise
        }*/
        await this.put(hash, first.content,true);
        return first;
    }
    put(hash: Hash, compressed: Uint8Array, downloaded:boolean): Promise<void> {
        // upload is manual
        return this.offline.put(hash,compressed,downloaded);
    }
    iterate(since: Date): AsyncGenerator<ObjectEntry> {
        // in offline
        return this.offline.iterate(since);
    }
    getState(): Promise<State> {
        return this.offline.getState();
    }
    setState(state: State): Promise<void> {
        return this.offline.setState(state);
    }
}