import fs, { mkdir } from 'fs';
import path from 'path';
import { asHash, BranchName, Hash,FilePath, asFilePath } from './types.js';


export type Config = {
    serverUrl: string,
    repoId: string,
};
export type State = {
    downloadSince: number,
    uploadSince: number,
};
export const GIT_DIR_NAME=".gsync";
export async function postJson(url:string, data={}){
    const response=await fetch(url, {method:"POST", body:JSON.stringify(data)});
    if (response.status!==200) {
        throw new Error(await response.text());
    }
    return {data: (await response.json()) as any};
}
export class Sync {
    constructor(public gitDir: FilePath) { }
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
        return conf;
    }
    async writeConfig(conf:Config): Promise<void> {
        const conffile = this.confFile();
        await fs.promises.writeFile(conffile, JSON.stringify(conf));
    }
    private confFile() {
        return asFilePath(path.join(this.gitDir, "remote-conf.json"));
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
        return asFilePath(path.join(this.gitDir, "remote-state.json"));
    }
    async writeState(state: State) {
        const statefile = this.stateFile();
        await fs.promises.writeFile(statefile, JSON.stringify(state));
    }

    async uploadObjects(): Promise<void> {
        const config = await this.readConfig();
        const state = await this.readState();
        const objectsDir = path.join(this.gitDir, 'objects');/*replace by ObjectStore*/
        const objects: { hash: string; content: string }[] = [];

        const dirs = fs.readdirSync(objectsDir).filter(d => /^[0-9a-f]{2}$/.test(d));
        const newUploadSince = Math.floor(Date.now() / 1000);
        for (const dir of dirs) {
            const dirPath = path.join(objectsDir, dir);
            const files = fs.readdirSync(dirPath).filter(f => /^[0-9a-f]{38}$/.test(f));

            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stats = fs.statSync(filePath);

                if (stats.mtimeMs < state.uploadSince * 1000) continue; // 秒→ミリ秒で比較

                const hash = dir + file;
                const raw = fs.readFileSync(filePath);
                const content = raw.toString('base64');

                objects.push({ hash, content });
            }
        }
        if (objects.length === 0) {
            console.log('No new objects to upload.');
            return;
        }
        //console.log(objects);

        const res = await postJson(`${config.serverUrl}?action=upload`, {
            repo_id: config.repoId,
            objects
        });
        await this.writeState({ uploadSince: newUploadSince, downloadSince: state.downloadSince });
        console.log(`Uploaded ${objects.length} objects. Server timestamp:`, res.data.timestamp);
    }


    async downloadObjects(): Promise<void> {
        const config = await this.readConfig();
        const state = await this.readState();
        const objectsDir = path.join(this.gitDir, 'objects');/*replace by ObjectStore*/

        const res = await postJson(`${config.serverUrl}?action=download`, {
            repo_id: config.repoId,
            since: state.downloadSince,
        });

        const objects: { hash: Hash; content: string }[] = res.data.objects;
        const newDownloadSince = res.data.newest - 0;
        let donloaded=0, skipped=0;
        for (const { hash, content } of objects) {
            asHash(hash);
            const dir = hash.slice(0, 2);
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
            }
        }
        console.log(donloaded," objects downloaded. ",skipped," objects skipped.");
        await this.writeState({ uploadSince: state.uploadSince, downloadSince: newDownloadSince });

    }
    async hasRemoteHead(branch: BranchName):Promise<boolean> {
        const { repoId, serverUrl } = await this.readConfig();
        const res = await postJson(`${serverUrl}?action=get_head`, {
            repo_id: repoId,
            allow_nonexistent: 1,
            branch
        });
        return !!res.data.hash;
    }


    async getRemoteHead(branch: BranchName): Promise<Hash> {
        const { repoId, serverUrl } = await this.readConfig();

        const res = await postJson(`${serverUrl}?action=get_head`, {
            repo_id: repoId,
            branch
        });

        const hash = res.data.hash as Hash;
        //await this.repo.updateHead(asLocalRef(branch), hash);
        console.log(`HEAD of '${branch}': ${hash ?? '(not set)'}`);
        return hash;
    }
    async setRemoteHead(branch: BranchName, current:Hash, next:Hash): Promise<void> {
        const { repoId, serverUrl } = await this.readConfig();
        //const hash:Hash= await this.repo.readHead(asLocalRef(branch));
        const {data}=await postJson(`${serverUrl}?action=set_head`, {
            repo_id: repoId,
            branch,
            current, next,
        });
        if (data.status==="ok") {
            return ;
        }
        throw new Error("Atomic change failed: Someone changed the head to "+data.status);
    }
    async addRemoteHead(branch: BranchName, next:Hash): Promise<void> {
        const { repoId, serverUrl } = await this.readConfig();
        //const hash:Hash= await this.repo.readHead(asLocalRef(branch));
        const {data}=await postJson(`${serverUrl}?action=set_head`, {
            repo_id: repoId,
            branch,
            next,
        });
        if (data.status==="ok") {
            return ;
        }
        throw new Error(branch+" already exists. status="+data.status);
    }
}
/*
downloadObjects().catch(console.error);

uploadObjects().catch(console.error);
*/