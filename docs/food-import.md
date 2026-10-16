# Food search, review and quick recipes

In **Food library → Import food**, choose **General foods** or **Packaged products**.

1. Search by name. Packaged products also accept a typed 8–14 digit barcode.
2. Open a result to preview its source link, per-100 g energy/macros and any reference portions. Packaged products show brand and barcode; the detail is fetched again from the product API rather than trusting a stale search index.
3. Choose **Review & add**. Correct the name, preparation, nutrition and optional serving weight. Missing nutrients must be filled from a trustworthy label; they are never silently zero-filled. A source expressed per 100 ml or an unsupported preparation is shown but cannot be imported as grams.
4. Confirm the review and **Add to library**. This saves a reusable food, not a diary entry. The source remains linked after edits, with edited provenance retained in the backup.

Imported foods work offline and sync with the rest of the library. General food search is bundled into the Android app and cached by the website service worker after its first successful download. Packaged-food search needs internet. Duplicate source records cannot be imported twice.

## Bought lunches and batch recipes

For a café meal, its own nutrition information is the best match. A generic sandwich or cake result is a reference estimate, not a measurement of that café's recipe. Choose a plausible match, check its ingredients/preparation and use your measured portion weight if available.

Use **Add one** for individual ingredients, or **Paste a list** for several at once. Switching keeps your draft. Identical additions combine their gram weights, and long recipes scroll within the ingredient list.

For more control, open **Recipes → New recipe → Paste a list**:

```text
Bread 120 g
Tuna 80 g
Tomato paste 15 g
Capers
Basil
Olive oil 10 g
```

These example amounts are not a prescribed recipe. The app searches your foods and the USDA catalog, presents several matches and shows nutrition/source for every row. Review each match, enter any missing grams, and choose **Add reviewed ingredients**. No quantities are guessed from “one tin”, “one slice” or a spoon measure. Uncheck a row to leave it out. Save the whole recipe with its finished weight and portions; mark it estimated when applicable. Its new ingredients are added to your library only when the recipe is saved.

Food diary entries have an optional **Time eaten**, defaulting to now for a new entry today. Old entries and backdated entries are left without a time unless you enter one. Entries sort by time within their meal group. Breakfast/Lunch/Dinner/Snacks are labels; changing the label does not change calories.

## Sources and maintenance

- [USDA FoodData Central downloads](https://fdc.nal.usda.gov/download-datasets/): SR Legacy April 2018 and FNDDS 2021–2023, published October 2024. Public domain/CC0. The reduced catalog contains 12,662 records with all five required nutrients; incomplete records are excluded. Portions preserve the source's description and gram weight. Original download checksums are in `public/data/usda-sources.json`.
- [Open Food Facts](https://world.openfoodfacts.org), contributed product data under [ODbL](https://opendatacommons.org/licenses/odbl/1-0/), individual contents under [DbCL](https://opendatacommons.org/licenses/dbcl/1-0/). No product images are copied. Review community data against the actual package. Imported product records are kept identifiable and attributed; comply with ODbL if redistributing the product database.

Regenerate the catalog from the official ZIPs (downloads are not part of every build):

```sh
python3 scripts/build-import-catalog.py /path/to/FoodData_Central_sr_legacy_food_json_2018-04.zip /path/to/FoodData_Central_survey_food_json_2024-10-31.zip
```

Packaged search uses Search-a-licious `/search`; preview uses the Open Food Facts v3.6 product endpoint with explicit nutrition units/basis. The public read-only `/api/food-search` route runs on Vercel and in the local Node server. It accepts only a search term/page or barcode, uses fixed upstreams, identifies Steady, caches responses, limits calls and sizes, and times out. It never receives diary records or authentication tokens. The frontend searches only when submitted, with a cooldown. Upstream availability and rate limits still apply. Open Food Facts asks API users to [register their usage](https://openfoodfacts.github.io/openfoodfacts-server/api/#before-you-start); no form was submitted on your behalf.

No new database tables, paid service or API key is needed. Vercel deploys `api/food-search.mjs` with the site. The native build defaults to this project's Vercel URL for packaged search. For another deployment, set `VITE_FOOD_API_URL=https://your-site.vercel.app` before `npm run native:sync`; browser and local-server builds use their own origin. This setting is public, not a secret. A native build can also target a trusted HTTPS local-server origin.

## Conversational food assistant

Open **Ask Steady**, the floating button at the bottom right of any page, or **Food diary → Ask about food**. Both reopen the same saved conversation. For example:

> I'm eating a tuna ftira from Panina in Malta.
> It's about 300 g; an estimate is fine if there is no published nutrition.
> Actually, I ate half of it, without mayonnaise.

The assistant can ask about size, ingredients and preparation, check saved foods/recipes, look up generic foods or packaged products, and optionally research a menu. A named restaurant is kept separate from a generic dish. Source nutrition is taken from the matched record, not replaced by model-generated numbers. New nutrition supplied by AI is always marked **Estimated**; menu ingredients alone do not verify calories.

Review each proposed food's **Nutrition & source**, edit grams, choose the meal/date/time, tick the review box, then **Save & log meal**. New library foods and diary entries save together; existing matches are reused. Uncheck **Also log what I ate** to save without adding diary entries. Conversations, recipe choices and unsent drafts are saved in this browser and restored when you reopen the dialog; **History** opens older chats. Chat history does not currently sync between devices.

Choose **Save as recipe** to keep the proposed foods together for next time. The name, weights, sources and nutrition are filled in; set the finished dish weight and number of servings. If ingredients were weighed raw, use the cooked batch weight. A whole-dish estimate remains one item, with its estimate flag and source; the app does not invent a recipe breakdown. With **Also log what I ate** selected, the current portions are logged once and the recipe is saved in the same transaction. Recipe servings determine future portions, not how much of the current proposal is logged.

After logging, reopen that chat and choose **Save as recipe**. This creates a reusable recipe without logging the food again. Recipes use the usual offline storage and device sync. Next time, open **Recipes → Log a portion** and choose grams or servings.

To correct a meal category, drag a diary entry onto Breakfast, Lunch, Dinner or Snacks. On a phone or keyboard, use **⋯ → Move**, then choose the destination meal. The move keeps the date, recorded time, portion and nutrition, and clears a skip on the destination meal. It saves offline and syncs like other diary changes. The same menu contains **Edit** and **Delete**; deletion still asks for confirmation.

When you provide a portion, the assistant can prepare a labelled nutrition estimate for review if exact data is unavailable. It records ingredient assumptions and does not treat those as a confirmed restaurant recipe. An incomplete structured proposal is checked and retried once; chat text alone cannot create a food entry. If a preview is still incomplete, **Prepare meal preview** retries with a labelled estimate where needed. Nothing is logged until you review and save it.

**Search food list** resolves pasted lines such as `Chicken breast 200 g` and `Olive oil 10 g` against saved foods and the offline USDA catalog without an AI key. Put one food on each line. Clicking it with an empty message shows instructions and focuses the input. Review the offered matches and enter any missing portion weight. It works offline once the catalog is cached (bundled in the phone app).

**Send** requires internet and a Groq key. The optional menu-research checkbox may use additional Groq quota. Follow [deployment setup](deployment.md#groq-food-assistant-setup) for encrypted account storage. In **AI settings**, enter your key and click **Save encrypted key** once to use it on your signed-in devices. A key typed without saving remains temporary. The library and conversation go to the Steady server; only relevant matches and the conversation go onward to Groq. No profile, activity or weight records are included.
