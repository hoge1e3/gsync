import * as fs from 'fs';
import * as path from 'path';
import { asHash, BranchName, Hash,FilePath, asFilePath, State, Config, IgnoreState } from './types.js';
import { factory, maxMtime, ObjectStore } from './objects.js';
import { REMOTE_CONF_FILE, REMOTE_STATE_FILE } from './constants.js';

export const GIT_DIR_NAME=".gsync";
export async function postJson(url:string, data={}){
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
}
export class Sync {
    _objectStore: ObjectStore|undefined;
    constructor(public gitDir: FilePath) { 
    }
    async getObjectStore(): Promise<ObjectStore> {
        if (this._objectStore) return this._objectStore;
        this._objectStore=await factory(this.gitDir);
        /*const objdir = asFilePath(path.join(this.gitDir, 'objects'));
        this._objectStore=new FileBasedObjectStore(objdir);   */
        return this._objectStore;
    }
    async init(serverUrl: string):Promise<string> {
        if (fs.existsSync(this.gitDir)) {
            throw new Error("Cannot init: "+this.gitDir+" already exists.");
        }
        // invoke create command (see /php/index.php)
        // and return new repository id
        const res = await postJson(`${serverUrl}?action=create`);
        // and write Config
        const conf: Config = {
            serverUrl,
            repoId: res.data.repo_id,
            apiKey: Math.random().toString(36).slice(2) ,
        };
        await fs.promises.mkdir(this.gitDir, { recursive: true });
        await this.writeConfig(conf);
        return res.data.repo_id;
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
        const statefile = this.stateFile();
        if (!fs.existsSync(statefile)) {
            return {
                downloadSince: 0,
                uploadSince: 0,
            };
        }
        const state = JSON.parse(await fs.promises.readFile(statefile, { encoding: "utf-8" })) as State;
        return state;
    }
    private stateFile() {
        return asFilePath(path.join(this.gitDir, REMOTE_STATE_FILE));
    }
    async writeState(state: State) {
        const statefile = this.stateFile();
        await fs.promises.writeFile(statefile, JSON.stringify(state));
    }

    async uploadObjects(): Promise<void> {
        const config = await this.readConfig();
        const state = await this.readState();
        //const objectsDir = path.join(this.gitDir, 'objects');/*replace by ObjectStore*/
        const objects: { hash: string; content: string }[] = [];

        //const dirs = fs.readdirSync(objectsDir).filter(d => /^[0-9a-f]{2}$/.test(d));
        const newUploadSince = Math.floor(Date.now() / 1000);
        const objectStore=await this.getObjectStore();
        for await (const entry of objectStore.iterate(new Date(state.uploadSince * 1000))) {
            objects.push({
                hash: entry.hash,
                content: toBase64(entry.content)
            });
        }
        if (objects.length === 0) {
            console.log('No new objects to upload.');
            return;
        }
        //console.log(objects);

        const res = await postJson(`${config.serverUrl}?action=upload`, {
            repo_id: config.repoId,
            api_key: config.apiKey,
            objects
        });
        await this.writeState({ uploadSince: newUploadSince, downloadSince: state.downloadSince });
        console.log(`Uploaded ${objects.length} objects. Server timestamp:`, res.data.timestamp);
    }


    async downloadObjects(ignoreState:IgnoreState="none"): Promise<void> {
        const config = await this.readConfig();
        const state = await this.readState();
        //const objectsDir = path.join(this.gitDir, 'objects');/*replace by ObjectStore*/

        const res = await postJson(`${config.serverUrl}?action=download`, {
            repo_id: config.repoId,
            api_key: config.apiKey,
            since: ignoreState==="all" ? 0:
                ignoreState==="max_mtime" ? await maxMtime(await this.getObjectStore()):
                state.downloadSince,
        });

        const objects: { hash: Hash; content: string }[] = res.data.objects;
        const newDownloadSince = res.data.newest - 0;
        const objectStore=await this.getObjectStore();
        let donloaded=0, skipped=0;
        for (const { hash, content } of objects) {
            asHash(hash);
            donloaded++;
            if (await objectStore.has(hash)) {
                skipped++;
            } else {
                const binary = Buffer.from(content, 'base64');
                await objectStore.put(hash,  binary);
            }
    
            /*const dir = hash.slice(0, 2);
            const file = hash.slice(2);
            const dirPath = path.join(objectsDir, dir);
            const filePath = path.join(dirPath, file);

            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            if (!fs.existsSync(filePath)) {
                const binary = Buffer.from(content, 'base64');
                fs.writeFileSync(filePath, binary);
                //console.log('Saved:', hash);
                donloaded++;
            } else {
                skipped++;
                //console.log('Skipped (exists):', hash);
            }*/
        }
        console.log(donloaded," objects downloaded. ",skipped," objects skipped.");
        await this.writeState({ uploadSince: state.uploadSince, downloadSince: newDownloadSince });

    }
    async hasRemoteHead(branch: BranchName):Promise<boolean> {
        const { repoId, serverUrl, apiKey } = await this.readConfig();
        const res = await postJson(`${serverUrl}?action=get_head`, {
            repo_id: repoId,
            allow_nonexistent: 1,
            api_key: apiKey,
            branch
        });
        return !!res.data.hash;
    }


    async getRemoteHead(branch: BranchName): Promise<Hash> {
        const { repoId, serverUrl, apiKey } = await this.readConfig();

        const res = await postJson(`${serverUrl}?action=get_head`, {
            repo_id: repoId,
            branch,
            api_key: apiKey,
        });

        const hash = res.data.hash as Hash;
        //await this.repo.updateHead(asLocalRef(branch), hash);
        console.log(`HEAD of '${branch}': ${hash ?? '(not set)'}`);
        return hash;
    }
    async setRemoteHead(branch: BranchName, current:Hash, next:Hash): Promise<void> {
        const { repoId, serverUrl, apiKey } = await this.readConfig();
        //const hash:Hash= await this.repo.readHead(asLocalRef(branch));
        const {data}=await postJson(`${serverUrl}?action=set_head`, {
            repo_id: repoId,
            branch,
            current, next,
            api_key: apiKey, 
        });
        if (data.status==="ok") {
            return ;
        }
        throw new Error("Atomic change failed: Someone changed the head to "+data.status);
    }
    async addRemoteHead(branch: BranchName, next:Hash): Promise<void> {
        const { repoId, serverUrl, apiKey } = await this.readConfig();
        //const hash:Hash= await this.repo.readHead(asLocalRef(branch));
        const {data}=await postJson(`${serverUrl}?action=set_head`, {
            repo_id: repoId,
            branch,
            next,
            api_key: apiKey,
        });
        if (data.status==="ok") {
            return ;
        }
        throw new Error(branch+" already exists. status="+data.status);
    }
}

function toBase64(content: Uint8Array<ArrayBufferLike>): string {
    if (typeof btoa !== "undefined") {
        let binary = "";
        for (let i = 0; i < content.length; i++) {
            binary += String.fromCharCode(content[i]);
        }
        return btoa(binary);
    } else {
        // Node.js environment without Buffer (fallback)
        throw new Error("Base64 encoding not supported in this environment without Buffer.");
    }
}
/*
downloadObjects().catch(console.error);

uploadObjects().catch(console.error);
*/