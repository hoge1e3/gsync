import { asFilePath, asHash, Config, FilePath, Hash, State } from "./types.js";
import * as path from "path";
import * as fs from "fs";
import MutablePromise from "mutable-promise";
import { DB_PREFIX, REMOTE_CONF_FILE, REMOTE_STATE_FILE, STATE_STORE_NAME, STORE_NAME } from "./constants.js";
export type ObjectValue = {
    content: Uint8Array;
    mtime: Date;
}
export type ObjectEntry = {
    hash: Hash;
}&ObjectValue;
export interface ObjectStore {
    has(hash: Hash): Promise<boolean>;
    get(hash: Hash): Promise<ObjectValue>;
    put(hash: Hash, compressed: Uint8Array): Promise<void>;
    iterate(since: Date): AsyncGenerator<ObjectEntry>;
    getState():Promise<State>;
    setState(state:State):Promise<void>;
}
export async function factory(gitDir:FilePath):Promise<ObjectStore>{
    const objdir = asFilePath(path.join(gitDir, 'objects'));
    const stateFile = asFilePath(path.join(gitDir, REMOTE_STATE_FILE));
    if (globalThis.indexedDB && !fs.existsSync(objdir)) {
        const conffile = asFilePath(path.join(gitDir, REMOTE_CONF_FILE));
        const conf = JSON.parse(await fs.promises.readFile(conffile, { encoding: "utf-8" })) as Config;
        return new IndexedDBBasedObjectStore(DB_PREFIX+"_"+conf.repoId, stateFile);
    } else {
        return new FileBasedObjectStore(objdir, stateFile);   
    }
}
export async function maxMtime(o:ObjectStore) {
    let max=new Date(0);
    for await(let e of o.iterate(new Date(0))) {
        if (e.mtime>max) max=e.mtime;
    }
    return max;
}
export function reqP<T>(request:IDBRequest<T>):Promise<T> {
    return new Promise<T>((resolve,reject)=>{
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
export function singleStoreTransaction(db:IDBDatabase, table:string, mode:IDBTransactionMode="readwrite") {
    const transaction = db.transaction(table, mode);
    const store = transaction.objectStore(table);
    return store;
}
export class IndexedDBBasedObjectStore implements ObjectStore {
    private db: IDBDatabase | null = null;
    dbInit=new MutablePromise<IDBDatabase>();
    constructor(public dbName: string, public stateFile: FilePath) {
        // Initialize IndexedDB
        const request = indexedDB.open(dbName,2);
        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
            if (!db.objectStoreNames.contains(STATE_STORE_NAME)) {
                db.createObjectStore(STATE_STORE_NAME);
            }
        };
        request.onsuccess = async (event: Event) => {
            this.db = (event.target as IDBOpenDBRequest).result;
            // if STATE_STORE_NAME is empty, read from stateFile and store it
            const store = singleStoreTransaction(this.db, STATE_STORE_NAME);
            const countRequest = store.count();
            if (await reqP(countRequest)=== 0) {
                // read from stateFile
                if (fs.existsSync(this.stateFile)) {
                    const state = JSON.parse(fs.readFileSync(this.stateFile, { encoding: "utf-8" })) as State;
                    await reqP(store.add(state));
                }
            }
            this.dbInit.resolve(this.db);
        };
        request.onerror = (event: Event) => {
            const error = (event.target as IDBOpenDBRequest).error;
            console.error("IndexedDB error:", error);
            this.dbInit.reject(error);
        }
    }
    async getState(): Promise<State> {
        await this.dbInit;
        const store=singleStoreTransaction(this.db!, STATE_STORE_NAME,"readonly");
        const cursor=await reqP(store.openCursor());
        if (!cursor) throw new Error("No state is set");
        return cursor.value;
    }
    async setState(state: State): Promise<void> {
        await this.dbInit;
        const store=singleStoreTransaction(this.db!, STATE_STORE_NAME);
        const cursor=await reqP(store.openCursor());
        if (!cursor) {
            await reqP(store.put(state));
        } else {
            const key=cursor.key;
            await reqP(store.put(state, key));
        }
    }
    async has(hash: Hash): Promise<boolean> {
        await this.dbInit;
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_NAME);
            const store = transaction.objectStore(STORE_NAME);
            const request = store.count(hash);
            request.onsuccess = () => resolve(request.result > 0);
            request.onerror = () => reject(request.error);
        });
    }
    async get(hash: Hash): Promise<ObjectValue> {
        await this.dbInit;
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_NAME);
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(hash);
            request.onsuccess = () => {
                if (request.result) {
                    const value:ObjectValue=request.result;
                    resolve(value);
                } else {
                    reject(new Error(`Object ${hash} not found. Consider run: gsync download-objects `));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
    async put(hash: Hash, compressed: Uint8Array): Promise<void> {
        await this.dbInit;
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_NAME, "readwrite");
            const value:ObjectValue = { content: compressed, mtime: new Date() };
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(value, hash);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });     
    }
    async *iterate(since: Date): AsyncGenerator<ObjectEntry> {
        await this.dbInit;
        const transaction = this.db!.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.openCursor();
        let resolve: (value?: ObjectEntry | undefined) => void;
        let reject: (reason?: any) => void;
        let promise: Promise<ObjectEntry | undefined>;
        const setPromise=()=>promise=new Promise((_resolve, _reject) => {
            resolve = (r)=>{setPromise(); _resolve(r); }
            reject = _reject;            
        });
        setPromise();
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                const { key, value }:{key:IDBValidKey, value:ObjectValue} = cursor ;
                if (value.mtime.getTime() >= since.getTime()) {
                    resolve({ hash: asHash(key.toString()), content: value.content, mtime: value.mtime });
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
        request.onerror = () => reject(request.error);
        while(true){
            const r=await promise!;
            if (!r) break;
            yield r;
        }            
    }
    /*
    IndexedDB-based object store
    */
}
export class FileBasedObjectStore implements ObjectStore {
    /*
    git-style object store
    */
    constructor(public path: FilePath, public stateFile:FilePath) {// path to "object" folder inside .git folder
    }
    async getState(): Promise<State> {
        return JSON.parse(await fs.promises.readFile(this.stateFile, "utf-8"));
    }
    async setState(state: State): Promise<void> {
        return await fs.promises.writeFile(this.stateFile, JSON.stringify(state));
    }
    private pathOf(hash: Hash): FilePath {
        // returns path to object file
        // e.g. path.join(this.path, hash.slice(0,2), hash.slice(2,40))
        return asFilePath(path.join(this.path, hash.slice(0, 2), hash.slice(2)));
    }
    async has(hash: Hash): Promise<boolean> {
        // returns true if object file exists
        return fs.existsSync(this.pathOf(hash));
    }
    async get(hash: Hash): Promise<ObjectValue> {
        // returns raw(compressed) Uint8Array of object file(no need to decompress/decode content)
        const filePath = this.pathOf(hash);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Object ${hash} not found at ${filePath}`);
        }
        return {content:fs.readFileSync(filePath), mtime: fs.statSync(filePath).mtime};
    }
    async put(hash: Hash, compressed: Uint8Array) {
        // saves raw(compressed) Uint8Array to object file
        const filePath = this.pathOf(hash);
        const dirPath = path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(filePath, compressed);
    }
    async *iterate(since: Date): AsyncGenerator<ObjectEntry> {
        // iterate newer or equals than since

        for (const head2 of fs.readdirSync(this.path)) {
            //head2 is first 2-chars of hash
            if (head2.length!=2) continue;
            const dir = path.join(this.path, head2);
            if (!fs.statSync(dir).isDirectory()) continue; // skip if not a directory
            const files = fs.readdirSync(dir);
            for (const rest38 of files) {
                const filePath = path.join(dir, rest38);
                const stat = fs.statSync(filePath);
                if (stat.mtime >= since) {
                    const hash = head2 + rest38; // assuming file name is the hash
                    yield { hash: asHash(hash), content: fs.readFileSync(filePath), mtime: stat.mtime };
                }
            }
        }
    }

}