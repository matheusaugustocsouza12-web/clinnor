# Modelos faciais 3D

Coloque aqui os arquivos GLB licenciados para uso comercial:

- `face-humanized.glb`
- `face-anatomical.glb`

O módulo usa malha procedural provisória enquanto esses arquivos não existirem. Esse fallback deve ser identificado em um único ponto no `face-map/index.js`.

Ao exportar os modelos:

- escala em metros, com o rosto voltado para o eixo -Z;
- origem centralizada na base do crânio;
- face voltada para a câmera frontal;
- partes anatômicas separadas com os nomes em inglês ou português usados pelo painel;
- aplicar escala e transformações antes da exportação.
