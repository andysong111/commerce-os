# Monthly freight barcode integration summary

The monthly purchase workspace now hands the selected month's actual 1688 order lines to the existing freight barcode generator. Ondolpass paste analysis joins primarily on the copied open-market order number, with 1688 offer ID, option text, and quantity used for disambiguation. Ambiguous duplicate candidates are intentionally left unmatched rather than receiving an arbitrary B-code.
