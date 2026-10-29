import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bailRecordsRouter from "./bail-records";
import discoveryRouter from "./discovery";
import workspaceAccessRouter from "./workspace-access";
import bailSearchRouter from "./bail-search";

const router: IRouter = Router();

router.use("/workspace-access", workspaceAccessRouter);
router.use("/bail-search", bailSearchRouter);
router.use(healthRouter);
router.use(bailRecordsRouter);
router.use(discoveryRouter);

export default router;
