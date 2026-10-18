// docs/04 §8 原样示例，独立测试台的离线基线。
export const MOCK =
{
  "room": {
    "id": "mock", "name": "示例：单套书桌",
    "bounds": { "x": 0, "y": 0, "z": 0, "w": 330, "d": 560, "h": 300 },
    "walls": [
      { "id": "wall-L", "box": { "x": -10, "y": 0, "z": 0,   "w": 10,  "d": 560, "h": 300 } },
      { "id": "wall-F", "box": { "x": 0,   "y": 0, "z": -10, "w": 330, "d": 10,  "h": 300 } }
    ],
    "openings": [
      { "id": "door", "type": "door", "box": { "x": 230, "y": 0, "z": -10, "w": 90, "d": 10, "h": 210 } }
    ],
    "fixtures": [
      { "id": "A.desk#fx",     "type": "desk",     "owner": "A", "label": "A 书桌", "box": { "x": 0, "y": 72,  "z": 170, "w": 60, "d": 130, "h": 3 } },
      { "id": "A.wardrobe#fx", "type": "wardrobe", "owner": "A", "label": "A 衣柜", "box": { "x": 0, "y": 0,   "z": 100, "w": 60, "d": 70,  "h": 170 } },
      { "id": "A.loftBed#fx",  "type": "loftBed",  "owner": "A", "label": "A 床",   "box": { "x": 0, "y": 175, "z": 105, "w": 90, "d": 200, "h": 15 } }
    ],
    "zones": [
      { "id": "A.desk", "slot": "desk", "label": "A 书桌桌面", "owner": "A", "kind": "surface",
        "box": { "x": 0, "y": 75, "z": 170, "w": 60, "d": 130, "h": 53 },
        "front": "+x", "tier": 0, "accepts": ["*"], "stackable": true },
      { "id": "A.underDesk", "slot": "underDesk", "label": "A 桌下", "owner": "A", "kind": "floor",
        "box": { "x": 0, "y": 0, "z": 260, "w": 60, "d": 40, "h": 70 },
        "front": "+x", "tier": 1, "accepts": ["luggage","storage","food","electronics","books","misc","toiletry"], "stackable": true },
      { "id": "pub.aisle", "slot": "aisle", "label": "过道", "owner": "pub", "kind": "keepClear",
        "box": { "x": 130, "y": 0, "z": 0, "w": 70, "d": 560, "h": 200 },
        "front": "+z", "tier": 1, "accepts": [], "stackable": false }
    ]
  },
  "items": [
    { "id": "it-001", "name": "27寸显示器", "category": "electronics", "size": { "w": 61, "d": 20, "h": 46 },
      "sizeSource": "product", "freq": "daily", "owner": "A",
      "flags": { "stackable": false, "canBearLoad": false, "rotatable": true, "canLieDown": false, "hangable": false,
                 "fragile": true, "focusTool": false, "disposable": false } },
    { "id": "it-002", "name": "零食盒", "category": "food", "size": { "w": 30, "d": 20, "h": 20 },
      "sizeSource": "estimated", "freq": "daily", "owner": "A",
      "flags": { "stackable": true, "canBearLoad": true, "rotatable": true, "canLieDown": false, "hangable": false,
                 "fragile": false, "focusTool": false, "disposable": false } },
    { "id": "it-003", "name": "24寸行李箱", "category": "luggage", "size": { "w": 42, "d": 26, "h": 66 },
      "sizeSource": "product", "freq": "rare", "owner": "A",
      "flags": { "stackable": false, "canBearLoad": true, "rotatable": true, "canLieDown": true, "hangable": false,
                 "fragile": false, "focusTool": false, "disposable": false,
                 "container": { "w": 38, "d": 22, "h": 61 } } }
  ],
  "placements": {
    "it-001": { "itemId": "it-001", "zoneId": "A.desk", "box": { "x": 0, "y": 75, "z": 205, "w": 20, "d": 61, "h": 46 }, "rot": 90, "lying": false, "layer": 0, "compressed": false },
    "it-002": { "itemId": "it-002", "zoneId": "A.desk", "box": { "x": 30, "y": 75, "z": 230, "w": 20, "d": 30, "h": 20 }, "rot": 90, "lying": false, "layer": 0, "compressed": false }
  }
}
;
