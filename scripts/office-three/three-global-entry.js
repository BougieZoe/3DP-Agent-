/* =====================================================================
   Agent Office · three.js 全局单文件打包入口（P1-10 角色 glTF 管线的加载基座）
   ---------------------------------------------------------------------
   用途：把 three 核心 + 角色模型所需 addons 打成「经典 script 可直接加载」的全局
        单文件，供 client/public/office.html 以 <script src="..."> 方式同步加载，
        在页面脚本执行前挂好 window.THREE（含 GLTFLoader / SkeletonUtils），
        消除线上「THREE is not defined」黑屏。

   产物：client/public/lib/three.global.min.js
        由 `pnpm build:office-lib` 生成（勿手改产物，改这里再重新构建）。

   构建：esbuild --bundle --format=iife --minify
        入口只 import 必需模块 → 产物无 import / export / 无 node 内置依赖，
        任何经典 script 环境（含 iframe 嵌入页）都能直接执行。
        P1-11 起额外并入 @pixiv/three-vrm（VRM 1.0 为主，内置 VRM 0.0 的 v0 导入兼容），
        仍是同一个 IIFE 单文件，页面侧无需新增 <script>。参考体积：
        three r184 核心 + GLTFLoader + SkeletonUtils ≈ 776 KB；并入 VRM 后见构建输出。

   挂载的全局（经典脚本语义，加载即就绪）：
     window.THREE                 three r184 核心（与 three.module.min.js 同一套导出）
     window.THREE.GLTFLoader      glTF / GLB / VRM 加载器（VRM 需注册下方插件）
     window.THREE.SkeletonUtils   { clone, retarget, ... } 蒙皮模型多实例复制
     window.THREE.VRMLoaderPlugin three-vrm 主插件（含 MToon 卡通材质 / humanoid /
                                  expression / springBone / lookAt / meta 子插件）
     window.THREE.VRMUtils        { rotateVRM0, combineSkeletons, removeUnnecessaryJoints,
                                    removeUnnecessaryVertices, deepDispose }
     window.THREE.MToonMaterialLoaderPlugin（MToon 卡通材质装配插件，材质实例由它创建）
     window.THREE.VRM             { ...同族入口, version } 命名空间，整组取用
   ===================================================================== */
import * as THREE_NS from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  VRMLoaderPlugin,
  MToonMaterialLoaderPlugin,
  VRMUtils,
} from "@pixiv/three-vrm";
import { version as VRM_PKG_VERSION } from "@pixiv/three-vrm/package.json";

/* ES 模块命名空间对象是 sealed 的，不能直接往上挂新属性；
   复制成普通对象再挂 addons，保证 window.THREE 可扩展（业务侧也能继续补挂）。 */
const THREE = Object.assign({}, THREE_NS);
THREE.GLTFLoader = GLTFLoader;
THREE.SkeletonUtils = SkeletonUtils;

/* ---- P1-11：VRM 角色模型支持（@pixiv/three-vrm）----
   VRMLoaderPlugin 内部按需装配 humanoid / expression / springBone / lookAt /
   firstPerson / meta / MToon 材质各子插件，并保留 VRM 0.0 的 v0 导入分支；
   业务侧用法（office3d.js · loadRoleModel）：
     const loader = new THREE.GLTFLoader();
     loader.register(parser => new THREE.VRMLoaderPlugin(parser));
     loader.load("role.vrm", gltf => { const vrm = gltf.userData.vrm; });
   同一 loader 注册后可同时加载 .glb / .vrm，不额外增加产物文件。 */
THREE.VRMLoaderPlugin = VRMLoaderPlugin;
THREE.MToonMaterialLoaderPlugin = MToonMaterialLoaderPlugin;
THREE.VRMUtils = VRMUtils;
THREE.VRM = {
  VRMLoaderPlugin,
  MToonMaterialLoaderPlugin,
  VRMUtils,
  version: VRM_PKG_VERSION,
};

THREE.OFFICE_BUNDLE = {
  core: THREE_NS.REVISION,
  addons: ["GLTFLoader", "SkeletonUtils"],
  vrm: VRM_PKG_VERSION,
  vrmAddons: ["VRMLoaderPlugin", "MToonMaterialLoaderPlugin", "VRMUtils"],
};

globalThis.THREE = THREE;
if (typeof window !== "undefined") window.THREE = THREE;
