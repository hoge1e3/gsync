import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { asHash, Hash, Path } from './types.js';
import { Repo } from './git.js';

type Config = {
    serverUrl: string,
    repoId: string,
};
type State = {
    downloadSince: number,
    uploadSince: number,
};

export class Sync {
    constructor(public gitDir: Path) { }
    async readConfig(): Promise<Config> {
        const conffile = this.confFile();
        const conf = JSON.parse(await fs.promises.readFile(conffile, { encoding: "utf-8" })) as Config;
        return conf;
    }
    private confFile() {
        return path.join(this.gitDir, "remote-conf.json");
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
        return path.join(this.gitDir, "remote-state.json");
    }
    async writeState(state: State) {
        const statefile = this.stateFile();
        await fs.promises.writeFile(statefile, JSON.stringify(state));
    }

    async uploadObjects(): Promise<void> {
        const config = await this.readConfig();
        const state = await this.readState();
        const objectsDir = path.join(this.gitDir, 'objects');
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

        const res = await axios.post(`${config.serverUrl}?action=upload`, {
            repo_id: config.repoId,
            objects
        });
        await this.writeState({ uploadSince: newUploadSince, downloadSince: state.downloadSince });
        console.log(`Uploaded ${objects.length} objects. Server timestamp:`, res.data.timestamp);
    }


    async downloadObjects(): Promise<void> {
        const config = await this.readConfig();
        const state = await this.readState();
        const objectsDir = path.join(this.gitDir, 'objects');

        const res = await axios.post(`${config.serverUrl}?action=download`, {
            repo_id: config.repoId,
            since: state.downloadSince,
        });

        const objects: { hash: Hash; content: string }[] = res.data.objects;
        const newDownloadSince = res.data.newest - 0;
        //console.log("objects",objects.map(o=>o.hash));
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
                console.log('Saved:', hash);
            } else {
                console.log('Skipped (exists):', hash);
            }
        }
        await this.writeState({ uploadSince: state.uploadSince, downloadSince: newDownloadSince });

    }
    async fetchHead(branch: BranchName): Promise<Hash> {
        const { repoId, serverUrl } = await this.readConfig();

        const res = await axios.post(`${serverUrl}?action=get_head`, {
            repo_id: repoId,
            branch
        });

        const hash = res.data.hash as Hash;
        const repo = new Repo(this.gitDir);
        await repo.updateHead(branch, hash);
        console.log(`HEAD of '${branch}': ${hash ?? '(not set)'}`);
        return hash;
    }
    async pushHead(branch: BranchName): Promise<void> {
        const { repoId, serverUrl } = await this.readConfig();
        const repo = new Repo(this.gitDir);
        const hash:Hash= await repo.readHead(branch);

        await axios.post(`${serverUrl}?action=set_head`, {
            repo_id: repoId,
            branch,
            hash
        });

        console.log(`Pushed HEAD of '${branch}' to ${hash}`);
    }
}
/*
downloadObjects().catch(console.error);

uploadObjects().catch(console.error);
*/