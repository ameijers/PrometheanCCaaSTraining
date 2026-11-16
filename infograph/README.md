# Infographic

An infographic of the training for LinkedIn posts, at LinkedIn's portrait size (4:5).

- `promethean-ccaas-training-linkedin.png`: the image to post, 2160 × 2700 pixels.
- `infographic.html`: its source, a page of 1080 × 1350.
- `render.js`: turns the page into the image.
To change it, edit `infographic.html`, then from the project folder:

```
node infograph/render.js . infograph/infographic.html infograph/promethean-ccaas-training-linkedin.png
```

It prints whether everything fits (`contentBottom` must be at most 1350). The facts on it come from the app: the lab titles from `content/labs/labs.json`, the features from the app itself. No Microsoft logos.
