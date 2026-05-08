import React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface ChartDataPoint {
  date: string;
  value: number;
}

interface RevenueChartProps {
  data: ChartDataPoint[];
  currencySymbol: string;
}

const RevenueChart: React.FC<RevenueChartProps> = ({ data, currencySymbol }) => {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${currencySymbol}${v}`}
            width={60}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              fontSize: "12px",
              color: "var(--foreground)",
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={((value: any) => [`${currencySymbol}${Number(value).toFixed(2)}`, "Revenue"]) as any}
            labelStyle={{ color: "var(--muted-foreground)" }}
          />
          <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} fill="url(#revenueGradient)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RevenueChart;
