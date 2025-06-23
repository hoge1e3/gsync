import {asBranchName, asPath, Hash, RelPath, Repo, TreeEntry} from "../src/git.js";
import * as assert from "assert";
export async function main(){
    const repo=new Repo(asPath(".git"));
    //const obj=await repo.readObject("00d6602b2832d060ad2a2f26c4b5bd957aa2dde8");
    //console.log(obj.type, obj.content);
    const head=await repo.readHead(asBranchName("main"));
    console.log(head);
    const commit=await repo.readCommit(head);
    console.log(commit);
    const tree=await repo.readTree(commit.tree);
    console.log(tree);
    console.log("---last commit ---");
    for await (let e of repo.traverseTree(tree)) {
        console.log(e.path, e.hash, await newLineType(e.path, e.hash));
        
    }
    console.log("---current working dir ---");
    const bt=await repo.buildTreeFromWorkingDir();
    for await (let e of repo.traverseTree(bt)) {
        console.log(e.path, e.hash, await newLineType(e.path, e.hash));
    }
    async function newLineType(path:RelPath, hash:Hash) {
        if (path.match(/\.(js|ts|json)$/)) {
            const text=await repo.readBlobAsText(hash);
            if (text.includes("\r\n")) return ("CR+LF");
            else if (text.includes("\n")) return ("LF");
            return "Oneline";
        } 
        return "bin";
    }
}    
main();
