import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bailRecordsRouter from "./bail-records";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bailRecordsRouter);

export default router;
