# Product launch option authority

- `발주·입고 데이터 불러오기` is an explicit import only.
- After import, the saved `orderOptions` on the individual launch item are authoritative.
- Opening product detail must never merge or restore all B-codes from other products that share the same model number.
- Manual option deletion/edit persists after Save.
- The background option guard may only attach a missing numeric `optionBarcodeNo` to the exact saved option list; it must not add or remove options.
- Same B-code keeps the same optionBarcodeNo through the registry.
