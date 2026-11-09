// Test-only read-only runtime evidence. Never requests glyphs or changes materials,
// textures, property blocks, fonts, game input, resolution, or product code.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using FairyGUI;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace LGUIAtlasRetest
{
    [InitializeOnLoad]
    public static class ShadowRuntimeDiagnosis
    {
        const string Key = "LGUI.AtlasRetest.";
        static readonly BindingFlags Fields = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        static readonly Encoding Utf8 = new UTF8Encoding(false);
        static readonly string[] FloatNames = {"_TextureWidth", "_TextureHeight", "_GradientScale", "_ScaleRatioA", "_ScaleRatioB", "_ScaleRatioC", "_UnderlayOffsetX", "_UnderlayOffsetY", "_UnderlaySoftness", "_UnderlayDilate", "_OutlineWidth", "_OutlineSoftness", "_FaceDilate", "_WeightNormal", "_WeightBold"};
        static readonly MethodInfo HasFloat = typeof(MaterialPropertyBlock).GetMethod("HasFloat", new[] {typeof(int)});

        [Serializable] sealed class TextureInfo { public int id, width, height; public string name, type, format, wrapMode, wrapModeU, wrapModeV, filterMode; }
        [Serializable] sealed class NTextureInfo { public int cachedWidth, cachedHeight; public Vector2 originalSize; public Rect region, uvRect; public bool nativeIsFontAtlas; public TextureInfo native; }
        [Serializable] sealed class FloatInfo { public string name, effectiveSource; public bool materialHasProperty, rendererHasProperty, indexHasProperty, hasFloatAPI, rendererHasFloat, indexHasFloat; public float material, rendererBlock, indexBlock, effective; }
        [Serializable] sealed class FormatInfo { public int size; public string font; public bool bold, italic; public float outline, faceDilate, fontSizeScale, renderScale, actualSize; public Vector2 shadowOffset; public Color shadowColor; }
        [Serializable] sealed class FontInfo { public string adapterType, name, assetName; public int assetId, atlasWidth, atlasHeight, atlasPadding; public float pointSize, faceScale, adapterScale, adapterFontSizeScale; public TextureInfo[] atlases; public NTextureInfo[] wrappers; }
        [Serializable] sealed class RendererInfo { public string path, displayName, ownerName, text, relation, meshFactoryType, materialName, shader, fontAssetName; public int rendererId, materialId, materialIndex, vertexCount, atlasIndex; public bool enabled, active, underlayOn, outlineOn, rendererBlockEmpty, indexBlockEmpty; public string[] keywords; public TextureInfo materialMainTexture; public NTextureInfo texture; public FormatInfo originalFormat; public FontInfo actualFont; public FloatInfo[] floats; public float expectedShadowX, expectedShadowY, texelsPerDesignPixel, computedUVX, computedUVY, computedDesignOffsetX, computedDesignOffsetY; }
        [Serializable] sealed class AssetInfo { public int id, atlasWidth, atlasHeight, atlasPadding; public string name; public TextureInfo[] atlases; public string[] fallbackNames; }
        [Serializable] sealed class Result { public bool sampled; public string utc, unityVersion, captureCamera, png, scope; public int frame, width, height; public float unityTime, realtime; public RendererInfo[] renderers; public AssetInfo[] loadedTMPFonts; public string[] logs; }
        [Serializable] sealed class DriverResult { public bool ok, pngPresent; public string phase, message; public int requestedFrame; public string[] logs; }

        static ShadowRuntimeDiagnosis()
        {
            EditorApplication.update += Tick;
            Camera.onPostRender += AfterCamera;
            Application.logMessageReceived += OnLog;
        }
        static string Arg(string key) { var a=Environment.GetCommandLineArgs(); for(int i=0;i+1<a.Length;i++)if(a[i]==key)return a[i+1];return null; }
        static string Stamp() { return DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture); }
        static double Since(string key) { return (DateTime.UtcNow-DateTime.Parse(SessionState.GetString(Key+key,Stamp()),CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind)).TotalSeconds; }
        static object Field(object value, Type owner, string name) { return value==null?null:owner.GetField(name,Fields)?.GetValue(value); }
        static float Number(object value, Type owner, string name) { var x=Field(value,owner,name);return x==null?0:Convert.ToSingle(x); }
        static void Write(string file, object value) { File.WriteAllText(file,JsonUtility.ToJson(value,true),Utf8); }
        static string[] Logs() { return SessionState.GetString(Key+"logs","").Split(new[]{'\u001e'},StringSplitOptions.RemoveEmptyEntries); }
        static void OnLog(string text,string stack,LogType type) { if(!SessionState.GetBool(Key+"active",false)||(type!=LogType.Error&&type!=LogType.Exception&&type!=LogType.Assert&&type!=LogType.Warning))return;SessionState.SetString(Key+"logs",SessionState.GetString(Key+"logs","")+type+": "+text+"\n"+stack+'\u001e'); }
        public static void Run()
        {
            string result=Arg("-lguiAtlasResult"),png=Arg("-lguiAtlasPng");
            if(string.IsNullOrEmpty(result)||string.IsNullOrEmpty(png)||!Path.IsPathRooted(result)||!Path.IsPathRooted(png)||File.Exists(result)||File.Exists(png))throw new ArgumentException("Fresh absolute -lguiAtlasResult and -lguiAtlasPng are required.");
            Directory.CreateDirectory(Path.GetDirectoryName(result));Directory.CreateDirectory(Path.GetDirectoryName(png));
            SessionState.SetString(Key+"result",result);SessionState.SetString(Key+"png",png);SessionState.SetString(Key+"start",Stamp());SessionState.SetString(Key+"logs","");SessionState.SetString(Key+"phase","entering");SessionState.SetBool(Key+"active",true);
            try { EditorSceneManager.OpenScene("Assets/LGUI/LGUIBoot.unity",OpenSceneMode.Single);EditorApplication.isPlaying=true; }
            catch(Exception e) { Fail(e.ToString()); }
        }
        static void Fail(string message)
        {
            Write(SessionState.GetString(Key+"result","")+".driver.json",new DriverResult{ok=false,phase=SessionState.GetString(Key+"phase",""),message=message,logs=Logs()});
            SessionState.SetInt(Key+"exit",1);Stop();
        }
        static void Stop() { SessionState.SetString(Key+"phase","stopping");SessionState.SetString(Key+"stop",Stamp());if(EditorApplication.isPlaying)EditorApplication.isPlaying=false; }
        static void Tick()
        {
            if(!SessionState.GetBool(Key+"active",false))return;
            try
            {
                string phase=SessionState.GetString(Key+"phase","");
                if(phase=="entering"&&EditorApplication.isPlaying){SessionState.SetString(Key+"play",Stamp());SessionState.SetString(Key+"phase","waiting-runtime");}
                if(phase=="waiting-runtime"&&Since("play")>=4&&HasRuntimeText()){SessionState.SetString(Key+"phase","armed");SessionState.SetString(Key+"armed",Stamp());}
                if(phase=="armed"&&Since("armed")>=1)Sample(null);
                if(phase=="capturing")
                {
                    string png=SessionState.GetString(Key+"png","");
                    bool present=File.Exists(png)&&new FileInfo(png).Length>32;
                    if((present&&Since("capture")>=0.5)||Since("capture")>=8){Write(SessionState.GetString(Key+"result","")+".driver.json",new DriverResult{ok=true,phase="complete",pngPresent=present,message=present?"":"Runtime parameters saved; batchmode ScreenCapture PNG did not appear. No forced render was used.",requestedFrame=SessionState.GetInt(Key+"frame",-1),logs=Logs()});SessionState.SetInt(Key+"exit",0);Stop();}
                }
                if(phase!="stopping"&&Since("start")>180)Fail("Timed out waiting for real runtime text, camera rendering or PNG; no forced render/refresh/glyph warm-up was used.");
                if(phase=="stopping"&&!EditorApplication.isPlayingOrWillChangePlaymode&&!EditorApplication.isCompiling&&Since("stop")>=0.5){int code=SessionState.GetInt(Key+"exit",1);SessionState.SetBool(Key+"active",false);EditorApplication.Exit(code);}
            }
            catch(Exception e){Fail(e.ToString());}
        }
        static bool HasRuntimeText()
        {
            bool shadow=false,player=false;
            foreach(var info in Resources.FindObjectsOfTypeAll<DisplayObjectInfo>())
            {
                var t=info.displayObject as TextField;if(t==null)continue;string n=t.gOwner==null?t.name:t.gOwner.name;
                if(n=="shadow"&&t.text=="Il齉")shadow=true;if(n=="runtimeName"&&t.text=="齉Player")player=true;
            }
            return shadow&&player;
        }
        static void AfterCamera(Camera camera)
        {
            if(!SessionState.GetBool(Key+"active",false)||!EditorApplication.isPlaying||SessionState.GetString(Key+"phase","")!="armed"||camera.name!=StageCamera.Name)return;
            Sample(camera);
        }
        static void Sample(Camera camera)
        {
            SessionState.SetString(Key+"phase","capturing");SessionState.SetString(Key+"capture",Stamp());SessionState.SetInt(Key+"frame",Time.frameCount);
            try
            {
                var rows=new List<RendererInfo>();
                foreach(var r in Resources.FindObjectsOfTypeAll<MeshRenderer>())if(r.gameObject.scene.IsValid())AddRenderer(rows,r);
                var fonts=new List<AssetInfo>();foreach(var a in Resources.FindObjectsOfTypeAll<TMP_FontAsset>())fonts.Add(Asset(a));
                var result=new Result{sampled=true,utc=Stamp(),unityVersion=Application.unityVersion,captureCamera=camera==null?"EditorApplication.update fallback after stable Play":camera.name,png=SessionState.GetString(Key+"png",""),scope="Read-only snapshot; ScreenCapture request and JSON use the same Time.frameCount. Camera.onPostRender preferred; stable EditorApplication.update fallback cannot certify same rendered frame. No product state/material/texture/glyph/size mutations.",frame=Time.frameCount,width=Screen.width,height=Screen.height,unityTime=Time.time,realtime=Time.realtimeSinceStartup,renderers=rows.ToArray(),loadedTMPFonts=fonts.ToArray(),logs=Logs()};
                ScreenCapture.CaptureScreenshot(result.png);Write(SessionState.GetString(Key+"result",""),result);
            }
            catch(Exception e){Fail(e.ToString());}
        }
        static string PathOf(Transform t) { return t.parent==null?t.name:PathOf(t.parent)+"/"+t.name; }
        static NGraphics Match(NGraphics g,MeshRenderer r){if(g==null)return null;if(g.meshRenderer==r)return g;if(g.subInstances!=null)foreach(var sub in g.subInstances){var found=Match(sub,r);if(found!=null)return found;}return null;}
        static void AddRenderer(List<RendererInfo> rows,MeshRenderer r)
        {
            NGraphics graphics=null,root=null;DisplayObject display=null;
            for(var tr=r.transform;tr!=null&&graphics==null;tr=tr.parent){var info=tr.GetComponent<DisplayObjectInfo>();var d=info==null?null:info.displayObject;if(d==null)continue;foreach(var candidate in new[]{d.graphics,d.paintingGraphics}){var found=Match(candidate,r);if(found!=null){graphics=found;root=candidate;display=d;break;}}}
            var text=root==null?null:root.meshFactory as TextField;if(text==null)text=display as TextField;
            if(graphics==null||text==null)return;
            TMPFont font=Field(text,typeof(TextField),"_font") as TMPFont;int atlas=0;
            if(graphics!=root&&graphics.meshFactory!=null){var type=graphics.meshFactory.GetType();font=Field(graphics.meshFactory,type,"font") as TMPFont??font;var a=Field(graphics.meshFactory,type,"atlasIndex");if(a!=null)atlas=(int)a;}
            var rendererBlock=new MaterialPropertyBlock();r.GetPropertyBlock(rendererBlock);
            var materials=r.sharedMaterials;
            for(int index=0;index<materials.Length;index++)
            {
                var mat=materials[index];if(mat==null||mat.shader==null||!mat.shader.name.Contains("TextMeshPro"))continue;
                var indexBlock=new MaterialPropertyBlock();r.GetPropertyBlock(indexBlock,index);var block=indexBlock.isEmpty?rendererBlock:indexBlock;
                var properties=new List<FloatInfo>();foreach(string name in FloatNames){int id=Shader.PropertyToID(name);bool rp=rendererBlock.HasProperty(id),ip=indexBlock.HasProperty(id);bool bp=block.HasProperty(id),mp=mat.HasProperty(id);float mv=mp?mat.GetFloat(id):0;properties.Add(new FloatInfo{name=name,materialHasProperty=mp,rendererHasProperty=rp,indexHasProperty=ip,hasFloatAPI=HasFloat!=null,rendererHasFloat=HasFloat!=null&&(bool)HasFloat.Invoke(rendererBlock,new object[]{id}),indexHasFloat=HasFloat!=null&&(bool)HasFloat.Invoke(indexBlock,new object[]{id}),material=mv,rendererBlock=rendererBlock.GetFloat(id),indexBlock=indexBlock.GetFloat(id),effective=bp?block.GetFloat(id):mv,effectiveSource=bp?(indexBlock.isEmpty?"renderer-property-block":"material-index-property-block"):"shared-material"});}
                var format=text.textFormat;float sizeScale=Number(text,typeof(TextField),"_fontSizeScale");var asset=font==null?null:font.fontAsset;
                var row=new RendererInfo{path=PathOf(r.transform),rendererId=r.GetEntityId().GetHashCode(),materialId=mat.GetEntityId().GetHashCode(),materialIndex=index,displayName=display==null?null:display.name,ownerName=text.gOwner==null?text.name:text.gOwner.name,text=text.text,relation=graphics==root?"main":"submesh",meshFactoryType=graphics.meshFactory.GetType().FullName,materialName=mat.name,shader=mat.shader.name,fontAssetName=asset==null?null:asset.name,enabled=r.enabled,active=r.gameObject.activeInHierarchy,underlayOn=mat.IsKeywordEnabled("UNDERLAY_ON"),outlineOn=mat.IsKeywordEnabled("OUTLINE_ON"),keywords=mat.shaderKeywords,rendererBlockEmpty=rendererBlock.isEmpty,indexBlockEmpty=indexBlock.isEmpty,vertexCount=graphics.mesh==null?0:graphics.mesh.vertexCount,atlasIndex=atlas,materialMainTexture=Texture(mat.HasProperty("_MainTex")?mat.GetTexture("_MainTex"):null),texture=NTexture(graphics.texture,asset,atlas),actualFont=Font(font),originalFormat=new FormatInfo{size=format.size,font=format.font,bold=format.bold,italic=format.italic,outline=format.outline,faceDilate=format.faceDilate,shadowOffset=format.shadowOffset,shadowColor=format.shadowColor,fontSizeScale=sizeScale,renderScale=Number(text,typeof(TextField),"_renderScale"),actualSize=format.size*sizeScale},floats=properties.ToArray(),expectedShadowX=format.shadowOffset.x,expectedShadowY=format.shadowOffset.y};
                float width=Value(row,"_TextureWidth"),height=Value(row,"_TextureHeight"),gradient=Value(row,"_GradientScale"),ratio=Value(row,"_ScaleRatioC");
                row.texelsPerDesignPixel=asset==null||row.originalFormat.actualSize==0?0:asset.faceInfo.pointSize/(row.originalFormat.actualSize*asset.faceInfo.scale);
                row.computedUVX=width==0?0:-Value(row,"_UnderlayOffsetX")*ratio*gradient/width;row.computedUVY=height==0?0:-Value(row,"_UnderlayOffsetY")*ratio*gradient/height;
                if(row.texture!=null&&row.texture.native!=null&&row.texelsPerDesignPixel!=0){row.computedDesignOffsetX=-row.computedUVX*row.texture.native.width/row.texelsPerDesignPixel;row.computedDesignOffsetY=row.computedUVY*row.texture.native.height/row.texelsPerDesignPixel;}
                rows.Add(row);
            }
        }
        static float Value(RendererInfo r,string name){foreach(var p in r.floats)if(p.name==name)return p.effective;return 0;}
        static TextureInfo Texture(UnityEngine.Texture t){if(t==null)return null;var t2=t as Texture2D;return new TextureInfo{id=t.GetEntityId().GetHashCode(),name=t.name,type=t.GetType().FullName,width=t.width,height=t.height,format=t2==null?"":t2.format.ToString(),wrapMode=t.wrapMode.ToString(),wrapModeU=t.wrapModeU.ToString(),wrapModeV=t.wrapModeV.ToString(),filterMode=t.filterMode.ToString()};}
        static NTextureInfo NTexture(FairyGUI.NTexture n,TMP_FontAsset a,int i){if(n==null)return null;var textures=a==null?null:a.atlasTextures;return new NTextureInfo{cachedWidth=n.width,cachedHeight=n.height,originalSize=n.originalSize,region=(Rect)Field(n,typeof(FairyGUI.NTexture),"_region"),uvRect=n.uvRect,native=Texture(n.nativeTexture),nativeIsFontAtlas=textures!=null&&i<textures.Length&&n.nativeTexture==textures[i]};}
        static FontInfo Font(TMPFont f){if(f==null)return null;var a=f.fontAsset;var wrappers=Field(f,typeof(TMPFont),"_atlasTextures") as FairyGUI.NTexture[];var ns=new List<NTextureInfo>();if(wrappers!=null)for(int i=0;i<wrappers.Length;i++)ns.Add(NTexture(wrappers[i],a,i));var ts=new List<TextureInfo>();if(a!=null)foreach(var t in a.atlasTextures)ts.Add(Texture(t));return new FontInfo{adapterType=f.GetType().FullName,name=f.name,assetName=a==null?null:a.name,assetId=a==null?0:a.GetEntityId().GetHashCode(),atlasWidth=a==null?0:a.atlasWidth,atlasHeight=a==null?0:a.atlasHeight,atlasPadding=a==null?0:a.atlasPadding,pointSize=a==null?0:a.faceInfo.pointSize,faceScale=a==null?0:a.faceInfo.scale,adapterScale=Number(f,typeof(TMPFont),"_scale"),adapterFontSizeScale=Number(f,typeof(TMPFont),"_fontSizeScale"),atlases=ts.ToArray(),wrappers=ns.ToArray()};}
        static AssetInfo Asset(TMP_FontAsset a){var ts=new List<TextureInfo>();foreach(var t in a.atlasTextures)ts.Add(Texture(t));var fs=new List<string>();if(a.fallbackFontAssetTable!=null)foreach(var f in a.fallbackFontAssetTable)fs.Add(f==null?null:f.name);return new AssetInfo{id=a.GetEntityId().GetHashCode(),name=a.name,atlasWidth=a.atlasWidth,atlasHeight=a.atlasHeight,atlasPadding=a.atlasPadding,atlases=ts.ToArray(),fallbackNames=fs.ToArray()};}
    }
}
