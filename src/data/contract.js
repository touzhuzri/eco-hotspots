/**
 * 数据契约（稳定边界）。改字段请同步 docs/ARCHITECTURE.md。
 *
 * Node: 挂在树层上的「来源生物」
 * Molecule: 与该来源关联的天然产物（结构可为 null，如大分子）
 */

/** @typedef {'sky'|'canopy'|'trunk'|'rhizosphere'|'soil'} LayerId */
/** @typedef {'植物'|'真菌'|'细菌'|'昆虫'|'生态角色'} Kingdom */

/**
 * @typedef {Object} Molecule
 * @property {string} nameZh
 * @property {string} nameEn
 * @property {string} chemClass
 * @property {string|null} inchikey  示例值须标注待核对
 * @property {string} note
 */

/**
 * @typedef {Object} Node
 * @property {string} id
 * @property {LayerId} layer
 * @property {{x:number,y:number}} hotspot  场景百分比坐标 0–100
 * @property {string} organismZh
 * @property {string} organismLatin
 * @property {Kingdom} kingdom
 * @property {Molecule[]} molecules
 * @property {string} ecoRole
 * @property {string[]} refs
 */

/**
 * @typedef {Object} EcoDataset
 * @property {{title:string,subtitle:string,disclaimer:string,snapshotNote:string}} meta
 * @property {{id:LayerId,label:string,hint:string}[]} layers
 * @property {Node[]} nodes
 */

export const LAYER_IDS = ["sky", "canopy", "trunk", "rhizosphere", "soil"];
export const KINGDOMS = ["植物", "真菌", "细菌", "昆虫", "生态角色"];

export function isValidNode(n) {
  return (
    n &&
    typeof n.id === "string" &&
    LAYER_IDS.includes(n.layer) &&
    KINGDOMS.includes(n.kingdom) &&
    n.hotspot &&
    typeof n.hotspot.x === "number" &&
    typeof n.hotspot.y === "number" &&
    Array.isArray(n.molecules)
  );
}
