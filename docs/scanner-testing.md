# Scanner Testing

Automated tests cover corner ordering, valid default crop, polygon area, self-intersection rejection and tiny-region rejection. Existing overlay coordinate tests remain active.

Manual validation still required with real photographs:

1. Straight white A4 sheet on a dark background.
2. Skewed A4 with all corners visible.
3. Paper with shadows or a background close to paper color.
4. Portrait photo carrying EXIF orientation.
5. Large photo near the 35 MB limit.

For each, verify detection confidence, manual handle accuracy, perspective output, rotation and repeated image replacement without increasing memory indefinitely.
