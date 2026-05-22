export const SHIPPERS = [
  { value: 'nakatomi-co',    label: 'Nakatomi Co.'   },
  { value: 'oceanic-air',    label: 'Oceanic Air'    },
  { value: 'wonka-sweets',   label: 'Wonka Sweets'   },
  { value: 'duff-logistics', label: 'Duff Logistics' },
  { value: 'acme-shipping',  label: 'ACME Shipping'  },
] as const;

export const PRODUCTS = [
  { value: 'coca-cola',       label: 'Coca-Cola'       },
  { value: 'pepsi',           label: 'Pepsi'           },
  { value: 'sprite',          label: 'Sprite'          },
  { value: 'fanta-orange',    label: 'Fanta Orange'    },
  { value: 'mountain-dew',    label: 'Mountain Dew'    },
  { value: 'dr-pepper',       label: 'Dr Pepper'       },
  { value: 'root-beer',       label: 'Root Beer'       },
  { value: 'ginger-ale',      label: 'Ginger Ale'      },
  { value: 'club-soda',       label: 'Club Soda'       },
  { value: 'tonic-water',     label: 'Tonic Water'     },
  { value: 'lemonade',        label: 'Lemonade'        },
  { value: 'iced-tea',        label: 'Iced Tea'        },
  { value: 'orange-juice',    label: 'Orange Juice'    },
  { value: 'apple-juice',     label: 'Apple Juice'     },
  { value: 'cranberry-juice', label: 'Cranberry Juice' },
  { value: 'sparkling-water', label: 'Sparkling Water' },
  { value: 'energy-drink',    label: 'Energy Drink'    },
  { value: 'sports-drink',    label: 'Sports Drink'    },
  { value: 'kombucha',        label: 'Kombucha'        },
  { value: 'coconut-water',   label: 'Coconut Water'   },
] as const;

export type ShipperValue = typeof SHIPPERS[number]['value'];
export type ProductValue = typeof PRODUCTS[number]['value'];

export const SHIPPER_VALUES = SHIPPERS.map((s) => s.value) as string[];
export const PRODUCT_VALUES = PRODUCTS.map((p) => p.value) as string[];
