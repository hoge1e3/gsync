import { asFilePath, asHash, FilePath, Hash } from "./types.js";
import * as path from "path";
import * as fs from "fs";
export type ObjectEntry = {
    hash: Hash;
    content: Uint8Array;
    mtime: Date;
};
export interface ObjectStore {
    has(hash: Hash): Promise<boolean>;
    get(hash: Hash): Promise<Uint8Array>;
    put(hash: Hash, compressed: Uint8Array): Promise<void>;
    iterate(since: Date): AsyncGenerator<ObjectEntry>;
}
export class IndexedDBBasedObjectStore implements ObjectStore {
    private db: IDBDatabase | null = null;
    constructor(public dbName: string, public storeName: string) {
        // Initialize IndexedDB
        const request = indexedDB.open(dbName);
        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(this.storeName)) {
                db.createObjectStore(this.storeName);
            }
        };
        request.onsuccess = (event: Event) => {
            this.db = (event.target as IDBOpenDBRequest).result;
        };
        request.onerror = (event: Event) => {
            console.error("IndexedDB error:", (event.target as IDBOpenDBRequest).error);
        }
    }
    has(hash: Hash): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(this.storeName);
            const store = transaction.objectStore(this.storeName);
            const request = store.count(hash);
            request.onsuccess = () => resolve(request.result > 0);
            request.onerror = () => reject(request.error);
        });
    }
    get(hash: Hash): Promise<Uint8Array> {
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(this.storeName);
            const store = transaction.objectStore(this.storeName);
            const request = store.get(hash);
            request.onsuccess = () => {
                if (request.result) {
                    resolve(new Uint8Array(request.result));
                } else {
                    reject(new Error(`Object ${hash} not found`));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
    put(hash: Hash, compressed: Uint8Array): Promise<void> {
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.put(compressed, hash);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });     
    }
    async *iterate(since: Date): AsyncGenerator<ObjectEntry> {
        const transaction = this.db!.transaction(this.storeName, "readonly");
        const store = transaction.objectStore(this.storeName);
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
                const { key, value } = cursor;
                if (value.mtime >= since) {
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
    constructor(public path: FilePath) {// path to "object" folder inside .git folder
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
    async get(hash: Hash): Promise<Uint8Array> {
        // returns raw(compressed) Uint8Array of object file(no need to decompress/decode content)
        const filePath = this.pathOf(hash);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Object ${hash} not found at ${filePath}`);
        }
        return fs.readFileSync(filePath);
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