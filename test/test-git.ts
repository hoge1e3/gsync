import {Repo} from "../src/git.js";
import * as assert from "assert";
export async function main(){
    const repo=new Repo(".git");
    //const obj=await repo.readObject("00d6602b2832d060ad2a2f26c4b5bd957aa2dde8");
    //console.log(obj.type, obj.content);
    const head=await repo.readHead("main");
    console.log(head);
    const commit=await repo.readCommit(head);
    console.log(commit);
    const tree=await repo.readTree(commit.tree);
    console.log(tree);
    for await (let e of repo.traverseTree(tree)) {
        console.log(e.path, e.hash);
    }
}    
main();
