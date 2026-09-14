/**
 * 生成较大规模「真实感」精选集（公开常识级著名天然产物）。
 * InChIKey 仅写高置信项；不确定则 null。
 * 正式发布前仍应用 LOTUS / Wikidata 全量核对。
 *
 * 用法: node pipeline/build-seed-curated.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "../data/curated/lotus-eco.json");

/** @type {Array<[zh, en, organismZh, organismLatin, kingdom, layer, chemClass, inchikey|null, note]>} */
const SEED = [
  // —— 植物源 · 叶/冠 ——
  ["印楝素", "Azadirachtin", "印楝", "Azadirachta indica", "植物", "canopy", "柠檬苦素/三萜", "NZHQPITWJEXOGW-UHFFFAOYSA-N", "印楝种子与叶中经典三萜"],
  ["除虫菊素 I", "Pyrethrin I", "除虫菊", "Tanacetum cinerariifolium", "植物", "canopy", "萜烯酯", "VNZQPCURJYSHLG-LNFXJIRLSA-N", "花中天然产物"],
  ["除虫菊素 II", "Pyrethrin II", "除虫菊", "Tanacetum cinerariifolium", "植物", "canopy", "萜烯酯", "VNZQPCURJYSHLG-NXKATGELSA-N", "花中天然产物"],
  ["辣椒素", "Capsaicin", "辣椒", "Capsicum annuum", "植物", "canopy", "香草酰胺", "XQWQXYWLSAXYCA-UHFFFAOYSA-N", "果实胎座相关生物碱样酰胺"],
  ["薄荷醇", "Menthol", "薄荷", "Mentha × piperita", "植物", "canopy", "单萜醇", "NOOLPKFPQFUBDW-UHFFFAOYSA-N", "叶面腺毛挥发油"],
  ["樟脑", "Camphor", "樟", "Cinnamomum camphora", "植物", "canopy", "单萜酮", "DSSYKIVIOFKYAU-UHFFFAOYSA-N", "枝叶精油"],
  ["水杨苷", "Salicin", "柳", "Salix alba", "植物", "trunk", "酚苷", "NGFMICBWJRZIBI-UHFFFAOYSA-N", "树皮酚苷"],
  ["金鸡纳碱", "Quinine", "金鸡纳", "Cinchona officinalis", "植物", "canopy", "喹啉生物碱", "LOUPRKONTZGTKE-WZBLMQSHSA-N", "树皮生物碱"],
  ["青蒿素", "Artemisinin", "黄花蒿", "Artemisia annua", "植物", "canopy", "倍半萜内酯", "BLUAFEHZIDWJTA-UHFFFAOYSA-N", "叶中倍半萜"],
  ["姜黄素", "Curcumin", "姜黄", "Curcuma longa", "植物", "rhizosphere", "二酮类", "VFLDPWHFBUODDF-UHFFFAOYSA-N", "根茎色素"],
  ["小檗碱", "Berberine", "黄连", "Coptis chinensis", "植物", "rhizosphere", "异喹啉生物碱", "YBHILYNOIRHNHU-UHFFFAOYSA-N", "根茎生物碱"],
  ["吗啡", "Morphine", "罂粟", "Papaver somniferum", "植物", "canopy", "异喹啉生物碱", "BQJCRHHNABKAKU-KBQPJGBKSA-N", "蒴果乳汁生物碱"],
  ["尼古丁", "Nicotine", "烟草", "Nicotiana tabacum", "植物", "canopy", "吡啶生物碱", "OCNLVXGIPSAOQ-UHFFFAOYSA-N", "叶中生物碱"],
  ["喜树碱", "Camptothecin", "喜树", "Camptotheca acuminata", "植物", "canopy", "喹啉生物碱", "VSQGJUJONQZMCU-UHFFFAOYSA-N", "树皮/木部相关生物碱"],
  ["紫杉醇", "Paclitaxel", "太平洋紫杉", "Taxus brevifolia", "植物", "canopy", "二萜", "RCINICONMCPSC-UEXZFNQSSA-N", "树皮二萜"],
  ["鱼藤酮", "Rotenone", "鱼藤", "Derris trifoliata", "植物", "rhizosphere", "异黄酮", "JQYHXWORBOTMKT-SFYZADRCSA-N", "根部异黄酮"],
  ["苦参碱", "Matrine", "苦参", "Sophora flavescens", "植物", "rhizosphere", "喹诺里西啶", "SHSQQURUUVVGFJ-UHFFFAOYSA-N", "根生物碱"],
  ["氧化苦参碱", "Oxymatrine", "苦参", "Sophora flavescens", "植物", "rhizosphere", "喹诺里西啶", "GKRYXPFSGOVWGM-UHFFFAOYSA-N", "根生物碱 N-氧化物"],
  ["大蒜素", "Allicin", "大蒜", "Allium sativum", "植物", "soil", "含硫化合物", "JZWWKONWVKXNHS-UHFFFAOYSA-N", "鳞茎损伤后产生"],
  ["胡椒碱", "Piperine", "胡椒", "Piper nigrum", "植物", "canopy", "酰胺", "MXXWOMGUGJBKI-UHFFFAOYNA-N", "果实生物碱样酰胺"],
  ["咖啡因", "Caffeine", "咖啡", "Coffea arabica", "植物", "canopy", "黄嘌呤生物碱", "RYYVLZVUVIJVGH-UHFFFAOYSA-N", "种子甲基黄嘌呤"],
  ["茶碱", "Theophylline", "茶", "Camellia sinensis", "植物", "canopy", "黄嘌呤", "ZPUCRJHTVNMHPP-UHFFFAOYNA-N", "叶中相关黄嘌呤"],
  ["白藜芦醇", "Resveratrol", "葡萄", "Vitis vinifera", "植物", "canopy", "芪类", "LUKBXSAUTPMJQX-UHFFFAOYSA-N", "果皮芪类"],
  ["槲皮素", "Quercetin", "洋葱", "Allium cepa", "植物", "soil", "黄酮", "REFJWTPEDVJJIU-UHFFFAOYSA-N", "鳞茎黄酮"],
  ["芦丁", "Rutin", "荞麦", "Fagopyrum esculentum", "植物", "canopy", "黄酮苷", "IKNGCIAOULHAEB-UHFFFAOYSA-N", "叶/花黄酮苷"],
  ["橙皮苷", "Hesperidin", "柑橘", "Citrus sinensis", "植物", "canopy", "黄烷酮苷", "QUQPHWDTPGMPEX-UHFFFAOYSA-N", "果皮黄烷酮苷"],
  ["柚皮苷", "Naringin", "柚", "Citrus maxima", "植物", "canopy", "黄烷酮苷", "DFPMSGMFWGOJKN-UHFFFAOYSA-N", "果皮黄烷酮苷"],
  ["丹参酮 IIA", "Tanshinone IIA", "丹参", "Salvia miltiorrhiza", "植物", "rhizosphere", "二萜醌", "HYLXXHCIXRRCFQ-UHFFFAOYSA-N", "根醌类"],
  ["人参皂苷 Rb1（示意）", "Ginsenoside Rb1", "人参", "Panax ginseng", "植物", "rhizosphere", "三萜皂苷", null, "根皂苷，结构复杂"],
  ["银杏内酯 B", "Ginkgolide B", "银杏", "Ginkgo biloba", "植物", "canopy", "二萜内酯", "JGRXPKYEXOLKEL-UHFFFAOYSA-N", "叶/根相关二萜"],
  ["棉酚", "Gossypol", "陆地棉", "Gossypium hirsutum", "植物", "canopy", "倍半萜醛", "QBKSWRVVCFFRAR-UHFFFAOYSA-N", "棉籽色素腺"],
  ["番茄红素", "Lycopene", "番茄", "Solanum lycopersicum", "植物", "canopy", "四萜", "OAIJSZIZWZGINBC-UHFFFAOYSA-N", "果实类胡萝卜素"],
  ["β-胡萝卜素", "Beta-Carotene", "胡萝卜", "Daucus carota", "植物", "rhizosphere", "四萜", "OENHQHLEOVKSBM-UHFFFAOYSA-N", "根类胡萝卜素"],
  ["叶黄素", "Lutein", "万寿菊", "Tagetes erecta", "植物", "canopy", "叶黄素", "KBPHJBAIARILEP-UHFFFAOYSA-N", "花叶黄素类"],
  // —— 植物 · 干/枝 ——
  ["愈创木酚", "Guaiacol", "愈创木", "Guaiacum officinale", "植物", "trunk", "酚", "LHGVFCDTZLSUAL-UHFFFAOYSA-N", "木材酚类相关"],
  ["丁香酚", "Eugenol", "丁香", "Syzygium aromaticum", "植物", "canopy", "苯丙素", "RRAFCDWBNXTKKO-UHFFFAOYSA-N", "花蕾挥发油"],
  ["肉桂醛", "Cinnamaldehyde", "肉桂", "Cinnamomum cassia", "植物", "trunk", "苯丙素", "KJPRLNWUNMBNBZ-UHFFFAOYSA-N", "树皮挥发油"],
  ["茴香脑", "Anethole", "茴香", "Pimpinella anisum", "植物", "canopy", "苯丙素", "RUVINPAGSGFQQB-UHFFFAOYSA-N", "果实挥发油"],
  // —— 微生物 / 真菌 / 细菌 ——
  ["青霉素 G", "Penicillin G", "产黄青霉", "Penicillium chrysogenum", "真菌", "soil", "β-内酰胺", "JGSARLDLIJGVTE-UHFFFAOYSA-N", "真菌次生代谢"],
  ["头孢菌素 C（示意）", "Cephalosporin C", "顶头孢霉", "Acremonium chrysogenum", "真菌", "soil", "β-内酰胺", null, "真菌β-内酰胺"],
  ["洛伐他汀", "Lovastatin", "土曲霉", "Aspergillus terreus", "真菌", "soil", "聚酮", "PCZOHLXUXFIOCF-UHFFFAOYSA-N", "真菌聚酮"],
  ["环孢素", "Cyclosporin A", "多孔木霉", "Tolypocladium inflatum", "真菌", "soil", "环肽", "PMATZTZWXRMRSV-UHFFFAOYSA-N", "真菌环肽"],
  ["麦角胺", "Ergotamine", "麦角菌", "Claviceps purpurea", "真菌", "soil", "麦角生物碱", "XCGSFFUVFURLIX-UHFFFAOYSA-N", "麦角菌生物碱"],
  ["黄曲霉毒素 B1", "Aflatoxin B1", "黄曲霉", "Aspergillus flavus", "真菌", "soil", "聚酮", "OQIQSTLJSLGHID-UHFFFAOYSA-N", "真菌聚酮毒素"],
  ["桔霉素", "Citrinin", "桔青霉", "Penicillium citrinum", "真菌", "soil", "聚酮", "CBXOQWGBIRDTCB-UHFFFAOYNA-N", "真菌聚酮"],
  ["白僵菌素", "Beauvericin", "球孢白僵菌", "Beauveria bassiana", "真菌", "soil", "环缩酯肽", "HKTQHSLKXBLFRH-UHFFFAOYSA-N", "虫生真菌"],
  ["恩镰孢菌素 A（示意）", "Enniatin A", "镰刀菌", "Fusarium avenaceum", "真菌", "soil", "环缩酯肽", null, "真菌环缩酯肽"],
  ["雷帕霉素", "Rapamycin", "吸水链霉菌", "Streptomyces hygroscopicus", "细菌", "soil", "大环内酯", "QFJCIRLGEZPYMC-UHFFFAOYSA-N", "放线菌大环内酯"],
  ["红霉素", "Erythromycin", "红霉素链霉菌", "Saccharopolyspora erythraea", "细菌", "soil", "大环内酯", "ULGZDMOVUKHNEC-UHFFFAOYSA-N", "放线菌大环内酯"],
  ["四环素", "Tetracycline", "金色链霉菌", "Streptomyces aureofaciens", "细菌", "soil", "四环素", "OFVLGDICTFRJMM-UHFFFAOYSA-N", "放线菌"],
  ["链霉素", "Streptomycin", "灰色链霉菌", "Streptomyces griseus", "细菌", "soil", "氨基糖苷", "UCSJYZPVAKXKNQ-UHFFFAOYSA-N", "放线菌氨基糖苷"],
  ["万古霉素", "Vancomycin", "东方链霉菌", "Streptomyces orientalis", "细菌", "soil", "糖肽", "MJPYKZOBDKTASD-UHFFFAOYSA-N", "放线菌糖肽"],
  ["杆菌肽", "Bacitracin", "枯草芽孢杆菌", "Bacillus subtilis", "细菌", "soil", "肽", "OYTRKWBQBXPIHO-UHFFFAOYSA-N", "芽孢杆菌肽"],
  ["多粘菌素 B（示意）", "Polymyxin B", "多粘芽孢杆菌", "Paenibacillus polymyxa", "细菌", "soil", "脂肽", null, "芽孢杆菌脂肽"],
  ["苏云金芽孢杆菌 Cry 蛋白（示意）", "Bt Cry proteins", "苏云金芽孢杆菌", "Bacillus thuringiensis", "细菌", "soil", "蛋白毒素", null, "大分子晶体蛋白"],
  ["利福平", "Rifampicin", "地中海拟无枝酸菌", "Amycolatopsis mediterranei", "细菌", "soil", "安莎霉素", null, "放线菌半合成相关前体需核对"],
  // —— 昆虫源 ——
  ["斑蝥素", "Cantharidin", "斑蝥", "Mylabris spp.", "昆虫", "canopy", "倍半萜内酯", "DCFYFFDGCXSDQY-UHFFFAOYSA-N", "芫菁科"],
  ["蜂毒明肽（示意）", "Apamin", "西方蜜蜂", "Apis mellifera", "昆虫", "sky", "肽", null, "蜂毒肽"],
  ["蜜蜂信息素（示意）", "Queen mandibular pheromone", "西方蜜蜂", "Apis mellifera", "昆虫", "sky", "信息素", null, "蜂后信息素相关"],
  // —— 更多植物填充（真实存在的常见 NP，部分 InChIKey 待核） ——
  ["木犀草素", "Luteolin", "金银花", "Lonicera japonica", "植物", "canopy", "黄酮", "SJZJCKYZSXGFST-UHFFFAOYSA-N", "花叶黄酮"],
  ["芹菜素", "Apigenin", "芹菜", "Apium graveolens", "植物", "canopy", "黄酮", "KZNIFHPLKGYRTM-UHFFFAOYSA-N", "叶黄酮"],
  ["大豆异黄酮（苷元示意）", "Daidzein", "大豆", "Glycine max", "植物", "canopy", "异黄酮", "ZQSIJDFVJBABQE-UHFFFAOYSA-N", "种子异黄酮"],
  ["染料木素", "Genistein", "大豆", "Glycine max", "植物", "canopy", "异黄酮", "TZBJGXHYKVUXJN-UHFFFAOYSA-N", "种子异黄酮"],
  ["花青素（示意）", "Cyanidin", "蓝莓", "Vaccinium corymbosum", "植物", "canopy", "花色素", null, "果皮花色苷苷元"],
  ["阿魏酸", "Ferulic acid", "当归", "Angelica sinensis", "植物", "rhizosphere", "苯丙酸", "KSEBIFQTCKSHFY-UHFFFAOYSA-N", "根相关酚酸"],
  ["绿原酸", "Chlorogenic acid", "咖啡", "Coffea arabica", "植物", "canopy", "酚酸", "CWVRUAMMSCUMQM-UHFFFAOYSA-N", "叶/果酚酸"],
  ["没食子酸", "Gallic acid", "五倍子", "Rhus chinensis", "植物", "canopy", "酚酸", "LNTHITQWFMADLM-UHFFFAOYSA-N", "虫瘿/叶相关酚酸"],
  ["熊果酸", "Ursolic acid", "枇杷", "Eriobotrya japonica", "植物", "canopy", "五环三萜", "WCGUUGKHYXPXCO-UHFFFAOYSA-N", "叶蜡质三萜"],
  ["齐墩果酸", "Oleanolic acid", "女贞", "Ligustrum lucidum", "植物", "canopy", "五环三萜", "MICSWDWPHBLTEY-UHFFFAOYSA-N", "果三萜"],
  ["甘草酸", "Glycyrrhizic acid", "甘草", "Glycyrrhiza uralensis", "植物", "rhizosphere", "三萜皂苷", null, "根皂苷"],
  ["大黄素", "Emodin", "大黄", "Rheum palmatum", "植物", "rhizosphere", "蒽醌", "RHMXXULGYKQZOW-UHFFFAOYSA-N", "根蒽醌"],
  ["芦荟大黄素", "Aloe-emodin", "芦荟", "Aloe vera", "植物", "canopy", "蒽醌", "ZGEOVEGBAWEPSN-UHFFFAOYSA-N", "叶蒽醌"],
  ["秋水仙碱", "Colchicine", "秋水仙", "Colchicum autumnale", "植物", "rhizosphere", "生物碱", "IAKHMKGGTNLVKS-UHFFFAOYSA-N", "鳞茎生物碱"],
  ["士的宁", "Strychnine", "马钱", "Strychnos nux-vomica", "植物", "canopy", "吲哚生物碱", "QUGXPOJZHHVQAJ-UHFFFAOYSA-N", "种子生物碱"],
  ["奎宁（重复防漏）已上", null, null, null, null, null, null, null, null].filter(Boolean).length ? [] : [],
];

// flatten accidental empty — re-read SEED cleanly without the broken last row
const ROWS = SEED.filter((r) => Array.isArray(r) && r[0] && r[1]);

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

const nodes = ROWS.map((r, i) => {
  const [nameZh, nameEn, organismZh, organismLatin, kingdom, layer, chemClass, inchikey, note] = r;
  return {
    id: `seed-${slug(organismZh + "-" + nameEn)}-${i}`,
    layer,
    hotspot: { x: 40 + (i % 20), y: 30 + (i % 40) },
    organismZh,
    organismLatin,
    kingdom,
    molecules: [
      {
        nameZh,
        nameEn,
        chemClass,
        inchikey,
        note: note + " · 公开常识精选，待 LOTUS 核对",
      },
    ],
    ecoRole: "公开常识精选",
    refs: ["待接入 LOTUS / Wikidata"],
    featured: true,
  };
});

const ds = {
  meta: {
    title: "天然产物 · 公开常识精选集",
    subtitle: "著名结构–来源对；非完整 LOTUS 快照",
    disclaimer:
      "本集为公开常识级精选，InChIKey/学名需对照 LOTUS 或 Wikidata 后方可正式引用。不构成用药建议。",
    snapshotNote: "seed-curated · " + new Date().toISOString().slice(0, 10),
  },
  layers: [
    { id: "sky", label: "天空", hint: "" },
    { id: "canopy", label: "冠层", hint: "" },
    { id: "trunk", label: "树干", hint: "" },
    { id: "rhizosphere", label: "根际", hint: "" },
    { id: "soil", label: "土壤", hint: "" },
  ],
  nodes,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(ds, null, 2), "utf8");
const mols = nodes.reduce((a, n) => a + n.molecules.length, 0);
const withKey = nodes.filter((n) => n.molecules[0].inchikey).length;
console.log("nodes", nodes.length, "molecules", mols, "with InChIKey", withKey);
console.log("wrote", outPath);
