import * as fs from 'fs';
import * as path from 'path';
import { asHash, BranchName, Hash,FilePath, asFilePath, State, Config, IgnoreState, GitObject, asPHPTimestamp } from './types.js';
import { factory, maxMtime, ObjectStore,ObjectEntry } from './objects.js';
import { REMOTE_CONF_FILE, REMOTE_STATE_FILE } from './constants.js';
import { dateToPhpTimestamp, phpTimestampToDate, toBase64 } from './util.js';
import { PHPClient, WebServerApi } from './webapi.js';

export const GIT_DIR_NAME=".gsync";
export class Sync {
    _objectStore: ObjectStore|undefined;
    _webapi: WebServerApi|undefined;
    constructor(public gitDir: FilePath) { 
    }
    async getObjectStore(): Promise<ObjectStore> {
        if (this._objectStore) return this._objectStore;
        this._objectStore=await factory(this.gitDir);
        return this._objectStore;
    }
    async getWebApi():Promise<WebServerApi> {
        if (this._webapi) return this._webapi;
        const config=await this.readConfig();
        this._webapi=new PHPClient(
            config.serverUrl,
            config.repoId,
            config.apiKey,
        );
        return this._webapi;
    }
    async init(serverUrl: string):Promise<string> {
        if (fs.existsSync(this.gitDir)) {
            throw new Error("Cannot init: "+this.gitDir+" already exists.");
        }
        const apiKey=Math.random().toString(36).slice(2);
        this._webapi=new PHPClient(
            serverUrl, 
            "init",
            apiKey,
        );
        // invoke create command (see /php/index.php)
        // and return new repository id
        const data = await this._webapi.createRepository();
        // and write Config
        const conf: Config = {
            serverUrl,
            repoId: data.repo_id,
            apiKey: Math.random().toString(36).slice(2) ,
        };
        await fs.promises.mkdir(this.gitDir, { recursive: true });
        await this.writeConfig(conf);
        return data.repo_id;
    }
    async readConfig(): Promise<Config> {
        const conffile = this.confFile();
        const conf = JSON.parse(await fs.promises.readFile(conffile, { encoding: "utf-8" })) as Config;
        if (!conf.apiKey) {
            conf.apiKey=Math.random().toString(36).slice(2);
            await this.writeConfig(conf);
        }
        return conf;
    }
    async writeConfig(conf:Config): Promise<void> {
        const conffile = this.confFile();
        await fs.promises.writeFile(conffile, JSON.stringify(conf));
    }
    private confFile() {
        return asFilePath(path.join(this.gitDir, REMOTE_CONF_FILE));
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
        await this.writeState({ uploadSince: newUploadSince, downloadSince: state.downloadSince });
        console.log(`Uploaded ${objects.length} objects. Server timestamp:`, newest/*res.data.timestamp*/);
    }
    async downloadObjects(ignoreState:IgnoreState="none"): Promise<void> {
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

    }
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
