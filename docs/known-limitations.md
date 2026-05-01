## Theme agent: discourse-blind

Theme operates on isolated tweets within our 72-hour scrape window. It cannot see when an external link or topic is generating broader discussion across the X ecosystem because the scraper doesn't follow conversation graphs (replies, quote-tweets, screenshots referencing the same source).

Symptom: when one author posts 3-4 tweets about a single source (e.g. Dwarkesh on a single podcast episode), Theme correctly declines to manufacture a theme around author prolificness, but misses that the *episode itself* is the day's discourse story.

Fix lives in the scrape layer, not the prompt: add reply/quote-tweet density signals to the input data, and Theme will be able to identify discourse storylines correctly.