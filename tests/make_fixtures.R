# Regenerates tests/fixtures.json from the reference R implementation.
# Synthetic input grids only. Run from the repo root:
#   Rscript tests/make_fixtures.R
suppressMessages(library(pmsampsize))
library(jsonlite)

quiet <- function(expr) tryCatch(suppressMessages(expr), error = function(e) NULL)
row_of <- function(o) if (is.null(o)) list(error = TRUE) else list(
  n = o$sample_size, n1 = o$results_table[1, 1], n2 = o$results_table[2, 1], n3 = o$results_table[3, 1])

surv <- expand.grid(nag = c(0.05, 0.10, 0.15, 0.25, 0.5), cs = NA, p = c(1, 3, 7, 15, 30),
                    rate = c(0.02, 0.065, 0.2), meanfup = c(1.5, 2.07, 5), shrink = c(0.9, 0.85))
surv_cs <- expand.grid(nag = NA, cs = c(0.02, 0.051, 0.12), p = c(1, 4, 9, 25),
                       rate = c(0.02, 0.065), meanfup = c(1.5, 5), shrink = 0.9)
surv <- rbind(surv, surv_cs)
surv_out <- lapply(seq_len(nrow(surv)), function(i) {
  r <- surv[i, ]
  args <- list(type = "s", parameters = r$p, shrinkage = r$shrink, rate = r$rate, timepoint = 2, meanfup = r$meanfup)
  if (!is.na(r$nag)) args$nagrsquared <- r$nag else args$csrsquared <- r$cs
  o <- quiet(do.call(pmsampsize, args))
  c(as.list(r), row_of(o), if (!is.null(o)) list(upper = o$int_uci) else list())
})

bin <- expand.grid(nag = c(0.05, 0.15, 0.3, 0.5), cs = NA, p = c(1, 2, 5, 12, 24),
                   prev = c(0.03, 0.174, 0.5, 0.8), shrink = c(0.9, 0.85))
bin_cs <- expand.grid(nag = NA, cs = c(0.02, 0.1, 0.288), p = c(1, 6, 24), prev = c(0.1, 0.174, 0.5), shrink = 0.9)
bin <- rbind(bin, bin_cs)
bin_out <- lapply(seq_len(nrow(bin)), function(i) {
  r <- bin[i, ]
  args <- list(type = "b", parameters = r$p, shrinkage = r$shrink, prevalence = r$prev)
  if (!is.na(r$nag)) args$nagrsquared <- r$nag else args$csrsquared <- r$cs
  c(as.list(r), row_of(quiet(do.call(pmsampsize, args))))
})

cst <- expand.grid(C = c(0.6, 0.7, 0.8, 0.9), prev = c(0.03, 0.174, 0.5, 0.9))
cst_out <- lapply(seq_len(nrow(cst)), function(i)
  list(C = cst$C[i], prev = cst$prev[i],
       r2 = pmsampsize:::cstat2rsq(cstatistic = cst$C[i], prevalence = cst$prev[i])$R2.coxsnell))

write_json(list(version = as.character(packageVersion("pmsampsize")),
                survival = surv_out, binary = bin_out, cstat = cst_out),
           "tests/fixtures.json", auto_unbox = TRUE, digits = NA, na = "null")
cat("wrote", length(surv_out), "survival,", length(bin_out), "binary,", length(cst_out), "C-statistic rows\n")
