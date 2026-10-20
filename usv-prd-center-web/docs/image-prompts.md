# 당사 모델 A·B·C·D 이미지 생성 프롬프트

이미지 생성 AI(ChatGPT 이미지, Gemini, Midjourney, Firefly 등)로 제품 라인업 사진을 만들 때 쓰는 프롬프트입니다.

## 사용 방법

1. 참고 이미지로 `public/img/ours/model-?.jpg`(3D 렌더링)를 함께 올리면 형상이 가장 잘 맞습니다. 실물 시제품 사진이 있으면 그 사진도 함께 올립니다.
2. 아래 영어 프롬프트를 그대로 붙여 넣습니다. 비율은 **16:10(또는 3:2) 가로**로 지정합니다.
3. 나온 이미지 중 하나를 `public/img/ours/model-a.jpg`처럼 같은 이름으로 덮어쓰면 홈페이지에 바로 반영됩니다.
4. 사진에는 '가상 프로토타입' 표시를 유지합니다. 홈페이지 카드에는 이미 표시되어 있습니다.

## 반드시 지킬 것

- **무장 금지.** 모델 C·D에 총·포·미사일·발사관을 그리지 않습니다. 생성 결과에 무장처럼 보이는 물체가 있으면 쓰지 않습니다.
- 글자가 깨지기 쉬우므로 선체 번호는 짧게(`A-01`) 쓰거나 생략합니다.
- 실존 회사 로고·국기·군 표식을 넣지 않습니다.

## 공통 디자인(모든 모델 앞에 붙이기)

```
Photorealistic marine photograph of a small uncrewed surface vessel (USV) prototype, Korean company design.
Faceted angular hull with sharp chines and a stealth-style raised faceted bow deck, matte finish.
On deck: a white EO/IR PTZ gimbal camera on a short pedestal, a small grey multi-lens panoramic camera pod at the front of the bow deck,
small white GNSS dome antennas, a flat white satellite antenna panel on top of a rectangular aft equipment box with a black vent grille,
two vertical white antenna poles at the stern, black cylindrical side sponson tubes along the aft gunwales.
Shot on a full-frame camera, 50mm lens, natural light, realistic water reflections, sharp focus on the boat, shallow depth of field on background.
No people, no weapons, no text except a short hull number.
```

## 모델 A 인명구조형 (3m급)

```
[공통 디자인] + 
Model A, 3.4 m rescue USV. Matte black upper hull, dark navy lower hull, a thin bright orange rub rail along the sheer line.
A red-and-white rescue ring buoy mounted on top of the aft equipment box, a black outboard motor on the transom.
Hull number "A-01" in orange on the side.
Scene: calm coastal water near Busan on a clear morning, distant hazy mountains, gentle bow wave and white wake, 3/4 front view from slightly above.
--ar 16:10
```

## 모델 B 해양관측형 (6m급)

```
[공통 디자인] +
Model B, 6 m ocean observation USV. Glossy white gelcoat hull with a thin teal stripe, dark navy bottom.
Two dark blue solar panels on the aft equipment box, a tall white meteorological mast with cup anemometer and wind vane on a crossarm,
a short sampling pole angled into the water at the bow.
Hull number "B-01" in dark teal.
Scene: open sea with offshore wind turbines in the far background, bright blue sky, calm water, slow cruising, 3/4 front view.
--ar 16:10
```

## 모델 C 저가 소모형 플랫폼 (6~7m급)

```
[공통 디자인] +
Model C, 6.5 m low-cost expendable USV platform. Dark grey faceted stealth hull,
a raked faceted fin tower amidships with a dark glass panel near its top and a small white PTZ camera on top,
a flat closed mission-bay hatch on the foredeck outlined with yellow dashed markings (cover only, nothing mounted on it).
NO weapons, no guns, no launchers.
Scene: misty sunrise at sea, low warm sun behind haze, fast planing with spray and a long white wake, 3/4 front view.
--ar 16:10
```

## 모델 D 국가중요시설 감시·정찰형 (4~5m급)

```
[공통 디자인] +
Model D, 4.6 m security patrol USV. Matte black hull with a thin violet rub rail,
a black pyramid-shaped mast carrying a white marine radar bar antenna, a white EO/IR gimbal,
a bright searchlight on the foredeck casting a beam over the water, a small grey loudspeaker horn, a black outboard motor.
NO weapons.
Scene: dusk patrol in front of a coastal nuclear power plant with two containment domes and a harbour crane on the far shore,
orange sunset sky fading to deep blue, plant lights reflecting on the water, 3/4 front view.
--ar 16:10
```

## 실물에 가깝게 고치는 요청 예시

- "선체 측면을 더 각지게, 선수 덮개를 사진처럼 다면체로"
- "무장으로 보이는 물체를 모두 지워 줘"
- "선체 번호 글자만 또렷하게, 다른 글자는 없애 줘"
