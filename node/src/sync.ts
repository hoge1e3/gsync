import * as fs from 'fs';
import * as path from 'path';
import { asHash, BranchName, Hash,FilePath, asFilePath, State, Config, IgnoreState, GitObject, asPHPTimestamp } from './types.js';
import { factory, maxMtime, ObjectStore,ObjectEntry } from './objects.js';
import { REMOTE_CONF_FILE, REMOTE_STATE_FILE } from './constants.js';
import { dateToPhpTimestamp, phpTimestampToDate, toBase64 } from './util.js';
import { PHPClient, WebServerApi } from './webapi.js';

export const GIT_DIR_NAME=".gsync";
/*export async function postJson(url:string, data={}){
    const response=await fetch(url, {method:"POST", body:JSON.stringify(data)});
    if (response.status!==200) {
        if(response.status===403) {
            const str=await response.text();
            console.log(str);
            throw new Error(str);
        }
        throw new Error(await response.text());
    }
    return {data: (await response.json()) as any};
}*/
export class Sync {
    _objectStore: ObjectStore|undefined;
    _webapi: WebServerApi|undefined;
    constructor(public gitDir: FilePath) { 
    }
    async getObjectStore(): Promise<ObjectStore> {
        if (this._objectStore) return this._objectStore;
        this._objectStore=await factory(this.gitDir);
        /*const objdir = asFilePath(path.join(this.gitDir, 'objects'));
        this._objectStore=new FileBasedObjectStore(objdir);   */
        return this._objectStore;
    }
    async getWebApi():Promise<WebServerApi> {
        if (this._webapi) return this._webapi;
        const config=await this.readConfig();
        this._webapi=new PHPClient(
            config.serverUrl,
            config.repoId,
            config.apiKey,
            //await this.getObjectStore(),
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
            //await this.getObjectStore(),
        );
        // invoke create command (see /php/index.php)
        // and return new repository id
        const data = await this._webapi.createRepository();// postJson(`${serverUrl}?action=create`);
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
    /*private _repo:Repo|undefined;
    get repo():Repo{
        this._repo = this._repo || new Repo(this.gitDir);
        return this._repo;
    }*/
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
    private stateFile() {
        return asFilePath(path.join(this.gitDir, REMOTE_STATE_FILE));
    }
    async writeState(state: State) {
        return await (await this.getObjectStore()).setState(state);

    }

    async uploadObjects(): Promise<void> {
        const config = await this.readConfig();
        const state = await this.readState();
        //const objectsDir = path.join(this.gitDir, 'objects');/*replace by ObjectStore*/
        const objects: ObjectEntry/*{ hash: string; content: string }*/[] = [];

        //const dirs = fs.readdirSync(objectsDir).filter(d => /^[0-9a-f]{2}$/.test(d));
        const newUploadSince = dateToPhpTimestamp(new Date());
        const objectStore=await this.getObjectStore();
        for await (const entry of objectStore.iterate(phpTimestampToDate(state.uploadSince))) {
            objects.push( entry/*{
                hash: entry.hash,
                content: toBase64(entry.content)
            }*/);
        }
        if (objects.length === 0) {
            console.log('No new objects to upload.');
            return;
        }
        //console.log(objects);
        const api=await this.getWebApi();
        const newest/*res*/ = await api.uploadObjects(objects)/* postJson(`${config.serverUrl}?action=upload`, {
            repo_id: config.repoId,
            api_key: config.apiKey,
            objects
        })*/;
        await this.writeState({ uploadSince: newUploadSince, downloadSince: state.downloadSince });
        console.log(`Uploaded ${objects.length} objects. Server timestamp:`, newest/*res.data.timestamp*/);
    }


    async downloadObjects(ignoreState:IgnoreState="none"): Promise<void> {
        const config = await this.readConfig();
        const state = await this.readState();
        //const objectsDir = path.join(this.gitDir, 'objects');/*replace by ObjectStore*/
        const api=await this.getWebApi();
        const since=  ignoreState==="all" ? new Date(0):
              ignoreState==="max_mtime" ? await maxMtime(await this.getObjectStore()):
              phpTimestampToDate(state.downloadSince);
        const {newest,objects} = await api.downloadSince(since/*postJson(`${config.serverUrl}?action=download`, {
            repo_id: config.repoId,
            api_key: config.apiKey,
            since,
        }*/);

        //const objects: { hash: Hash; content: string }[] = res.data.objects;
        const newDownloadSince = dateToPhpTimestamp(newest);
        const objectStore=await this.getObjectStore();
        let downloaded=0, skipped=0;
        for (const { hash, content } of objects) {
            asHash(hash);
            downloaded++;
            if (await objectStore.has(hash)) {
                skipped++;
            } else {
                //const binary = Buffer.from(content, 'base64');
                await objectStore.put(hash,  content);
            }
        }
        console.log(downloaded," objects downloaded. ",skipped," objects skipped.");
        
        await this.writeState({ uploadSince: state.uploadSince, downloadSince: newDownloadSince });

    }
    async hasRemoteHead(branch: BranchName):Promise<boolean> {
        const { repoId, serverUrl, apiKey } = await this.readConfig();
        const api=await this.getWebApi();
        const data = await api.hasHead(branch)/* postJson(`${serverUrl}?action=get_head`, {
            repo_id: repoId,
            allow_nonexistent: 1,
            api_key: apiKey,
            branch
        })*/;
        return /*!!*/data/*.hash*/;
    }


    async getRemoteHead(branch: BranchName): Promise<Hash> {
        const { repoId, serverUrl, apiKey } = await this.readConfig();
        const api=await this.getWebApi();
        const hash = await api.getHead(branch/*postJson(`${serverUrl}?action=get_head`, {
            repo_id: repoId,
            branch,
            api_key: apiKey,
        }*/);

        //const hash = res.data.hash as Hash;
        //await this.repo.updateHead(asLocalRef(branch), hash);
        console.log(`HEAD of '${branch}': ${hash ?? '(not set)'}`);
        return hash;
    }
    async setRemoteHead(branch: BranchName, current:Hash, next:Hash): Promise<void> {
        const { repoId, serverUrl, apiKey } = await this.readConfig();
        //const hash:Hash= await this.repo.readHead(asLocalRef(branch));
        const api=await this.getWebApi();
        /*const {data}=*/await api.setHead(branch, current, next/*postJson(`${serverUrl}?action=set_head`, {
            repo_id: repoId,
            branch,
            current, next,
            api_key: apiKey, 
        }*/);
        /*if (data.status==="ok") {
            return ;
        }
        throw new Error("Atomic change failed: Someone changed the head to "+data.status);*/
    }
    async addRemoteHead(branch: BranchName, next:Hash): Promise<void> {
        const { repoId, serverUrl, apiKey } = await this.readConfig();
        //const hash:Hash= await this.repo.readHead(asLocalRef(branch));
        const api=await this.getWebApi();
        /*const {data}=*/await api.addHead(branch, next/*postJson(`${serverUrl}?action=set_head`, {
            repo_id: repoId,
            branch,
            next,
            api_key: apiKey,
        }*/);
        /*if (data.status==="ok") {
            return ;
        }
        throw new Error(branch+" already exists. status="+data.status);*/
    }
}

/*
downloadObjects().catch(console.error);

uploadObjects().catch(console.error);
*/