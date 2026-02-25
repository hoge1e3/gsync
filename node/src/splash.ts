export let instance:SplashScreen;
type SplashScreen={
    show(text: string): Promise<void>;
    hide(): Promise<void>;
}
declare const pNode:any;
export async function getSplashScreen(){
    if (instance) return instance;
    try {
        instance=await pNode.importModule(
            "@acepad/splashscreen",
            pNode.urlToPath(import.meta.url));
    }catch(e) {
        instance={
            async show(...a){},
            async hide(){}
        }
    }
    return instance;
}