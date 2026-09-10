# Qwen3-0.6B Setup

This directory contains the standalone Qwen3-0.6B setup using `transformers.js`.

## Setup

The model dependency is defined in `package.json`.
To install: `npm install`

## Running the Smoke Test

To verify the model loading and inference:

`node ai-models/qwen-loader.js`

## Notes

* Model weights are managed by `transformers.js` and are cached locally. They are NOT committed to Git.
* No Hugging Face authentication token is required for this public model.
